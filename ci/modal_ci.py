"""Dispatch committed source to credential-free Modal Ubuntu, as pi-codemode-bench does."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

from settings import CI_CELLS, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, NODES, evidence_path, validate_cell

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = "/workspace"
REPORTS = "/tmp/ci-results"
# The source-file mount may leave /tmp at 0755. Restore normal sticky-directory
# permissions inside this disposable container before dropping root privileges.
PREPARE_ENV = 'set -euo pipefail; chmod 1777 /tmp; exec runuser -u dsh-ci -- "$@"'
BOOTSTRAP = """
set -euo pipefail
git init -q
git fetch -q /tmp/source.bundle HEAD
git checkout -q --force --detach FETCH_HEAD
node --version
python3 --version
exec python3 ci/run_ci.py "$@"
"""


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def prepare_source(root, staging):
    """Never upload local Git config, ignored files, credentials or dirty source."""
    if git(root, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise RuntimeError("Modal CI requires a full Git checkout")
    if git(root, "status", "--porcelain", "--untracked-files=no").strip():
        raise RuntimeError("Commit tracked changes before running Modal CI")
    head = git(root, "rev-parse", "HEAD").decode().strip()
    for name in ("package.json", "package-lock.json"):
        (staging / name).write_bytes(git(root, "show", f"{head}:{name}"))
    git(root, "bundle", "create", str(staging / "source.bundle"), "HEAD")
    return head


def make_image(modal, staging, node_version):
    archive = f"node-v{node_version}-linux-x64.tar.xz"
    install = (
        f"curl --fail --silent --show-error --location "
        f"https://nodejs.org/dist/v{node_version}/{archive} -o /tmp/node.tar.xz"
        f" && echo '{NODES[node_version]}  /tmp/node.tar.xz' | sha256sum --check -"
        " && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1"
        " && rm /tmp/node.tar.xz"
    )
    return (
        modal.Image.from_registry("ubuntu:24.04", add_python="3.12")
        .apt_install("git", "curl", "ca-certificates", "xz-utils", "build-essential", "cmake", "pkg-config", "procps", "util-linux", "passwd")
        .run_commands(install)
        .env({"CI": "true"})
        .workdir(WORKSPACE)
        .add_local_file(staging / "package.json", f"{WORKSPACE}/package.json", copy=True)
        .add_local_file(staging / "package-lock.json", f"{WORKSPACE}/package-lock.json", copy=True)
        .run_commands("npm ci --ignore-scripts")
        # Permission-denial regressions must execute, not skip as container root.
        .run_commands("useradd --create-home --uid 10001 --user-group dsh-ci && chown -R dsh-ci:dsh-ci /workspace")
        .add_local_file(staging / "source.bundle", "/tmp/source.bundle")
    )


def copy_stream(stream, destination):
    for line in stream:
        print(line, end="", file=destination, flush=True)


def collect_evidence(sandbox, output):
    """Copy bounded text reports only; never extract an untrusted archive."""
    manifest = json.loads(sandbox.filesystem.read_text(f"{REPORTS}/manifest.json"))
    names = manifest.get("files")
    if not isinstance(names, list) or not 1 <= len(names) <= MAX_FILES:
        raise RuntimeError("missing or oversized Modal evidence manifest")
    if len(set(name for name in names if isinstance(name, str))) != len(names):
        raise RuntimeError("invalid or duplicate Modal evidence names")
    paths = [evidence_path(name) for name in names]
    if "summary.json" not in names:
        raise RuntimeError("Modal evidence has no completion summary")
    output.mkdir(parents=True, exist_ok=False)
    total = 0
    for name, path in zip(names, paths):
        content = sandbox.filesystem.read_bytes(f"{REPORTS}/{name}")
        size = len(content)
        total += size
        if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
            raise RuntimeError("Modal evidence exceeds collection limits")
        destination = output.joinpath(*path.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return json.loads((output / "summary.json").read_text())


def run_validation(modal, image, suite, node_version, pair, output, *, app, source):
    """One isolated cell under an already-running app; never create an app here."""
    validate_cell(suite, node_version, pair)
    timeout = 2700 if suite == "live" else 600
    sandbox = modal.Sandbox.create(
        "sleep", str(timeout + 60), app=app, image=image, workdir=WORKSPACE,
        cpu=4 if suite == "live" else 2, memory=8192 if suite == "live" else 2048,
        timeout=timeout + 60, secrets=[],
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            process = sandbox.exec(
                "bash", "-c", PREPARE_ENV, "dsh-env", "bash", "-c", BOOTSTRAP, "dsh-ci", "--suite", suite,
                "--node-version", node_version, "--pair", pair, "--artifacts", REPORTS,
                timeout=timeout,
            )
            stdout = pool.submit(copy_stream, process.stdout, sys.stdout)
            stderr = pool.submit(copy_stream, process.stderr, sys.stderr)
            process.wait()
            stdout.result(timeout=30)
            stderr.result(timeout=30)
            # Failed runs must retain their reports too, before termination.
            summary = collect_evidence(sandbox, output)
            if process.returncode != 0 or summary.get("exit_code") != 0:
                raise RuntimeError(f"Modal Ubuntu {suite} failed (exit {process.returncode}); see evidence")
            if (summary.get("suite"), summary.get("node"), summary.get("pair")) != (suite, node_version, pair):
                raise RuntimeError("Modal summary does not match the requested CI cell")
            if summary.get("source") != source:
                raise RuntimeError("Modal validated a different source revision")
            required = {"package-install", "package-check", "package-pack", "tracked-clean", "whitespace"}
            if suite == "live":
                required.update({"prepare-upstreams", "ownership-lifecycle", "live-pty"})
                if pair == "merged-022":
                    required.update({"upstream-projection-lifecycle", "upstream-durable-model"})
                if summary.get("live") != {"passed": 32, "failed": 0, "skipped": 0}:
                    raise RuntimeError("Modal live result lacks complete Ubuntu PTY coverage")
            completed = summary.get("completed")
            if not isinstance(completed, list) or not all(isinstance(name, str) for name in completed):
                raise RuntimeError("Modal summary has invalid completed checks")
            if not required.issubset(completed) or summary.get("platform") != "Linux":
                raise RuntimeError("Modal did not complete the required Ubuntu checks")
            if isinstance(sandbox.object_id, str):
                summary["sandbox_id"] = sandbox.object_id
            return summary
        finally:
            sandbox.terminate()


def validate_matrix(cells, max_parallel):
    canonical = {cell["id"]: cell for cell in CI_CELLS}
    if not isinstance(max_parallel, int) or not 1 <= max_parallel <= len(CI_CELLS):
        raise ValueError("parallelism must be between 1 and 4")
    if not cells or len(cells) > len(CI_CELLS):
        raise ValueError("select between 1 and 4 CI cells")
    seen = set()
    for cell in cells:
        if not isinstance(cell, dict) or cell.get("id") not in canonical or cell != canonical[cell["id"]]:
            raise ValueError("only pinned CI cells can be dispatched")
        if cell["id"] in seen:
            raise ValueError("duplicate CI cell")
        seen.add(cell["id"])


def run_matrix(modal, staging, cells, output, source, max_parallel=2):
    """One app owns all cells. Cell failures do not cancel the remaining cells."""
    validate_matrix(cells, max_parallel)
    output.mkdir(parents=True, exist_ok=False)
    app = modal.App("dsh-session-cleanup-ci")
    results = {}
    app_id = None
    dispatcher_error = None
    try:
        with modal.enable_output(), app.run():
            if isinstance(app.app_id, str):
                app_id = app.app_id
            # Both Node images are shared by package/live cells, not rebuilt per cell.
            images = {version: make_image(modal, staging, version)
                      for version in dict.fromkeys(cell["node_version"] for cell in cells)}
            with ThreadPoolExecutor(max_workers=max_parallel) as pool:
                futures = {
                    pool.submit(run_validation, modal, images[cell["node_version"]], cell["suite"],
                                cell["node_version"], cell["pair"], output / cell["id"],
                                app=app, source=source): cell for cell in cells
                }
                for future in as_completed(futures):
                    cell = futures[future]
                    try:
                        summary = future.result()
                        results[cell["id"]] = {"status": "success", "summary": summary}
                    except Exception as error:
                        # Preserve partial evidence; never retry by creating another app.
                        results[cell["id"]] = {"status": "failure", "error": str(error)}
                        directory = output / cell["id"]
                        directory.mkdir(parents=True, exist_ok=True)
                        (directory / "dispatcher-error.json").write_text(json.dumps({
                            "cell": cell["id"], "error": str(error),
                        }, indent=2) + "\n")
                    print(f"Modal cell {cell['id']}: {results[cell['id']]['status']}", flush=True)
    except BaseException as error:
        dispatcher_error = type(error).__name__
        raise
    finally:
        for cell in cells:
            results.setdefault(cell["id"], {"status": "not_run"})
        report = {
            "source": source, "app_id": app_id,
            "exit_code": int(dispatcher_error is not None or any(item["status"] != "success" for item in results.values())),
            "cells": {cell["id"]: results[cell["id"]] for cell in cells},
        }
        if dispatcher_error:
            report["dispatcher_error"] = dispatcher_error
        (output / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--cell", action="append", choices=[cell["id"] for cell in CI_CELLS],
                        help="Select a cell; repeat to select several. The default is all four in one app.")
    parser.add_argument("--max-parallel", type=int, choices=range(1, 5), default=2)
    parser.add_argument("--output", type=Path, default=ROOT / "ci-results")
    args = parser.parse_args()
    by_id = {cell["id"]: cell for cell in CI_CELLS}
    cells = [by_id[name] for name in args.cell] if args.cell else list(CI_CELLS)
    validate_matrix(cells, args.max_parallel)
    if args.output.exists():
        raise RuntimeError("use a fresh evidence output directory")
    # Only this dispatcher imports the authenticated SDK, never the Sandbox.
    import modal

    with TemporaryDirectory(prefix="dsh-modal-ci-") as temporary:
        staging = Path(temporary)
        head = prepare_source(args.root.resolve(), staging)
        print(f"Validating committed source {head} on Modal Ubuntu in one app", flush=True)
        report = run_matrix(modal, staging, cells, args.output.resolve(), head, args.max_parallel)
    text = f"## Modal Ubuntu matrix\n\nSource: `{head}`\n\n```json\n{json.dumps(report, indent=2)}\n```\n"
    print(text)
    if path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(path, "a", encoding="utf-8") as output:
            output.write(text)
    return report["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
