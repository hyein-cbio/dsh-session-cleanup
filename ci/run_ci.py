#!/usr/bin/env python3
"""Provider-neutral package and real upstream PTY checks; never publishes."""

import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from tempfile import TemporaryDirectory

from settings import MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, PNPM_VERSION, evidence_path, validate_cell

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from upstream_pairs import PAIRS


class Runner:
    def __init__(self, artifacts, env):
        self.artifacts = artifacts
        self.env = env
        self.completed = []

    def run(self, name, args, cwd=ROOT):
        print(f"CI {name}: {' '.join(map(str, args))}", flush=True)
        path = self.artifacts / f"{name}.log"
        with path.open("w") as output:
            result = subprocess.run(args, cwd=cwd, env=self.env, text=True,
                                    stdout=output, stderr=subprocess.STDOUT)
        print(path.read_text(errors="replace"), end="", flush=True)
        result.check_returncode()
        self.completed.append(name)


def clean_environment(source):
    markers = ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL")
    return {key: value for key, value in source.items()
            if not any(marker in key.upper() for marker in markers)
            and key not in {"SSH_AUTH_SOCK", "GITHUB_ENV", "BASH_ENV", "NODE_OPTIONS"}
            and not key.startswith("DSH_COMPAT_")}


def package_checks(runner, circleci=False):
    runner.run("package-install", ["npm", "ci", "--ignore-scripts"])
    if circleci:
        runner.run("package-build", ["npm", "run", "lint"])
        runner.run("test-clean-before", ["npm", "run", "test:clean"])
        try:
            runner.run("test-compile", ["node", "node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"])
            runner.run("node-tests", ["circleci", "testsuite", "run", "node tests"])
        finally:
            runner.run("test-clean-after", ["npm", "run", "test:clean"])
        runner.run("python-tests", ["npm", "run", "test:live-driver"])
    else:
        runner.run("package-check", ["npm", "run", "check"])
    runner.run("package-pack", ["npm", "pack", "--dry-run"])
    runner.run("tracked-clean", ["git", "diff", "--exit-code", "HEAD"])
    runner.run("whitespace", ["git", "diff", "--check"])


def checkout_upstream(runner, name, repository, ref, target, submodules=False):
    # Repositories and refs come only from the checked-in upstream allowlist.
    runner.run(f"{name}-init", ["git", "init", "-q", str(target)])
    runner.run(f"{name}-fetch", ["git", "fetch", "--depth=1", f"https://github.com/{repository}.git", ref], target)
    runner.run(f"{name}-checkout", ["git", "checkout", "--detach", "FETCH_HEAD"], target)
    if submodules:
        runner.run(f"{name}-submodules", ["git", "submodule", "update", "--init", "--recursive"], target)
    actual = subprocess.check_output(["git", "-C", str(target), "rev-parse", "HEAD"], env=runner.env, text=True).strip()
    if actual != ref:
        raise RuntimeError(f"{name} checkout does not match the pinned commit")


def live_checks(runner, pair, temporary):
    source = PAIRS[pair]
    harness, tui = temporary / "harness", temporary / "tui"
    upstream_logs = runner.artifacts / "upstream"
    upstream_logs.mkdir()
    runner.env.update({
        "DSH_COMPAT_PAIR": pair,
        "DSH_COMPAT_HARNESS_ROOT": str(harness), "DSH_COMPAT_TUI_ROOT": str(tui),
        "DSH_COMPAT_HOME": str(temporary / "profile-home"), "DSH_COMPAT_LOG": str(upstream_logs),
    })
    checkout_upstream(runner, "harness", source["harness_repository"], source["harness_ref"], harness)
    checkout_upstream(runner, "tui", source["tui_repository"], source["tui_ref"], tui, submodules=True)
    tools = temporary / "tools"
    runner.run("pnpm-install", ["npm", "install", "--prefix", str(tools), "--ignore-scripts",
                                "--no-audit", "--no-fund", f"pnpm@{PNPM_VERSION}"])
    runner.env["PATH"] = str(tools / "node_modules/.bin") + os.pathsep + runner.env["PATH"]
    runner.run("prepare-upstreams", [sys.executable, str(ROOT / "scripts/prepare-upstream-ci.py")])
    prepared = json.loads((upstream_logs / "prepared.json").read_text())
    for key in ("DSH_COMPAT_NODE", "DSH_COMPAT_BIN", "DSH_COMPAT_CWD"):
        runner.env[key] = prepared[key]
    if pair == "merged-022":
        runner.env["NODE_ENV"] = "production"
        for name, script in (("upstream-projection-lifecycle", "verify-plugin-lifecycle.ts"),
                             ("upstream-durable-model", "verify-durable-model-selection.ts")):
            runner.run(name, ["node", "--import", "./scripts/lib/fake-home.mjs", "--import", "tsx/esm",
                              f"scripts/{script}"], tui)
        runner.env.pop("NODE_ENV", None)
    runner.run("ownership-lifecycle", ["node", "scripts/check-upstream-lifecycle.mjs"])
    runner.run("live-pty", [sys.executable, "scripts/live-upstream-tui.py"])
    report = json.loads((upstream_logs / "live-full.json").read_text())
    expected = 33 if sys.platform == "darwin" else 32
    if (report["passed"], report["failed"], report["skipped"]) != (expected, 0, 0):
        raise RuntimeError("incomplete or unsuccessful real upstream PTY coverage")
    return {key: report[key] for key in ("passed", "failed", "skipped")}


def write_manifest(artifacts):
    files, total = [], 0
    for path in sorted(artifacts.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("refuse symlink in CI evidence")
        if not path.is_file() or path.name == "manifest.json":
            continue
        name = path.relative_to(artifacts).as_posix()
        evidence_path(name)
        size = path.stat().st_size
        total += size
        if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES or len(files) >= MAX_FILES:
            raise RuntimeError("CI evidence exceeds collection limits")
        files.append(name)
    (artifacts / "manifest.json").write_text(json.dumps({"files": files}, indent=2) + "\n")


def execute(suite, node_version, pair, artifacts, circleci=False):
    validate_cell(suite, node_version, pair)
    artifacts.mkdir(parents=True, exist_ok=False)
    env = clean_environment(os.environ)
    env["CI"] = "true"
    runner = Runner(artifacts, env)
    summary = {"suite": suite, "node": node_version, "pair": pair, "platform": platform.system(),
               "architecture": platform.machine(), "uid": os.geteuid(), "exit_code": 1, "completed": runner.completed}
    code = 1
    try:
        if os.geteuid() == 0:
            raise RuntimeError("Run CI checks as a non-root user so permission-denial regressions are not skipped")
        actual = subprocess.check_output(["node", "--version"], env=env, text=True).strip()
        if actual != f"v{node_version}":
            raise RuntimeError(f"expected Node v{node_version}, got {actual}")
        if sys.version_info < (3, 10):
            raise RuntimeError("Python 3.10+ is required")
        summary["source"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, env=env, text=True).strip()
        with TemporaryDirectory(prefix="dsh-cloud-ci-") as directory:
            temporary = Path(directory).resolve()
            env.setdefault("NPM_CONFIG_CACHE", str(temporary / "npm-cache"))
            package_checks(runner, circleci)
            if suite == "live":
                summary["live"] = live_checks(runner, pair, temporary)
        code = 0
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"CI failed: {error}", file=sys.stderr, flush=True)
        summary["error"] = str(error)
    finally:
        summary["exit_code"] = code
        (artifacts / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        write_manifest(artifacts)
    print(json.dumps(summary), flush=True)
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("package", "live"), required=True)
    parser.add_argument("--node-version", required=True)
    parser.add_argument("--pair", default="")
    parser.add_argument("--artifacts", type=Path, default=ROOT / "ci-results")
    parser.add_argument("--circleci", action="store_true")
    args = parser.parse_args()
    return execute(args.suite, args.node_version, args.pair, args.artifacts.resolve(), args.circleci)


if __name__ == "__main__":
    raise SystemExit(main())
