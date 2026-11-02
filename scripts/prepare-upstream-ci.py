#!/usr/bin/env python3
"""Build the pinned upstreams and install their real, disposable CI profile."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def run(name: str, args: list[str], cwd: Path, env: dict[str, str], log: Path,
        *, capture_stdout: bool = False) -> str | None:
    print(f"{name}: {' '.join(args)}", flush=True)
    with (log / f"{name}.log").open("w") as output:
        result = subprocess.run(args, cwd=cwd, env=env, text=True,
                                stdout=subprocess.PIPE if capture_stdout else output,
                                stderr=output if capture_stdout else subprocess.STDOUT)
        if capture_stdout:
            output.write(result.stdout)
    if result.returncode:
        print((log / f"{name}.log").read_text(errors="replace"), flush=True)
        raise SystemExit(f"{name} failed ({result.returncode}); see {log / f'{name}.log'}")
    return result.stdout if capture_stdout else None


def find_tarball(directory: Path) -> Path:
    """Use the actual artifact in a fresh, package-specific output directory."""
    tarballs = list(directory.glob("*.tgz"))
    if len(tarballs) != 1 or not tarballs[0].is_file():
        raise SystemExit(f"expected exactly one source-built tarball in {directory}; found {len(tarballs)}")
    tarball = tarballs[0].resolve()
    if tarball.parent != directory.resolve():
        raise SystemExit(f"source-built tarball escaped output directory: {tarball}")
    return tarball


def main() -> None:
    log = Path(os.environ["DSH_COMPAT_LOG"]).resolve()
    log.mkdir(parents=True, exist_ok=True)
    harness = Path(os.environ["DSH_COMPAT_HARNESS_ROOT"]).resolve()
    tui = Path(os.environ["DSH_COMPAT_TUI_ROOT"]).resolve()
    home = Path(os.environ["DSH_COMPAT_HOME"]).resolve()
    # Never reuse real user state, or a partial profile from an earlier attempt.
    if home.exists():
        raise SystemExit(f"refuse existing sandbox HOME: {home}")
    node = shutil.which("node")
    if node is None:
        raise SystemExit("Node is required")
    profile = home / ".dsh/profiles/dsh-tui"
    values = {
        "DSH_COMPAT_NODE": str(Path(node).resolve()),
        "DSH_COMPAT_BIN": str(harness / "apps/cli/lib/bin.js"),
        "DSH_COMPAT_CWD": str(profile),
    }
    os.environ.update(values)
    spec = importlib.util.spec_from_file_location("live_upstream_tui", ROOT / "scripts/live-upstream-tui.py")
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)
    driver.validate_sources(driver.Report())
    env = driver.scrub(os.environ.copy())
    env["CI"] = "true"
    # These are source builds. Keep upstream lockfiles and compatibility gates intact.
    run("harness-install", ["pnpm", "install", "--frozen-lockfile"], harness, env, log)
    run("harness-native", ["pnpm", "run", "build:native-system"], harness, env, log)
    run("harness-build", ["pnpm", "exec", "tsx", "scripts/compile-referenced-projects.ts", "host-libraries"], harness, env, log)
    # The base bundle also mounts these Node halves of dual-client packages.
    run("harness-dual-client", ["pnpm", "--filter", "@deepseek-ai/dsh-typert-registry",
                                "--filter", "@deepseek-ai/dsh-api-gateway", "run", "bundle"], harness, env, log)
    run("tui-install", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--config.node-linker=hoisted"], tui, env, log)
    run("tui-build", ["pnpm", "run", "compile"], tui, env, log)
    run("plugin-install", ["npm", "ci"], ROOT, env, log)
    run("plugin-build", ["npm", "run", "build"], ROOT, env, log)
    packs = home / "tarballs"
    packs.mkdir(parents=True)
    tui_packs = packs / "tui"
    tui_packs.mkdir()
    # Lifecycle scripts can mix their stdout into pnpm pack --json output.
    # A fresh destination identifies the actual artifact without parsing logs.
    run("tui-pack", ["pnpm", "pack", "--config.node-linker=hoisted", "--pack-destination", str(tui_packs)], tui, env, log)
    tui_pack = find_tarball(tui_packs)
    packed = run("plugin-pack", ["npm", "pack", "--json", "--pack-destination", str(packs)],
                 ROOT, env, log, capture_stdout=True)
    plugin_pack = packs / json.loads(packed)[0]["filename"]
    if not tui_pack.is_file() or not plugin_pack.is_file():
        raise SystemExit("expected source-built tarballs were not produced")
    profile.mkdir(parents=True)
    env.update({
        "HOME": str(home), "DSH_HOME": str(home / ".dsh"),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_STATE_HOME": str(home / ".local/state"),
    })
    run("profile-install", [node, values["DSH_COMPAT_BIN"], "plugin", "--profile", "dsh-tui", "add",
                            f"file:{tui_pack}", f"file:{plugin_pack}"], profile, env, log)
    # The driver itself boots/exits the fresh host before accessing workspace storage.
    (log / "prepared.json").write_text(json.dumps({**values, "harness": str(harness), "tui": str(tui)}, indent=2) + "\n")
    with Path(os.environ["GITHUB_ENV"]).open("a") as output:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise SystemExit("environment paths must not contain newlines")
            output.write(f"{key}={value}\n")
    print("Source-built profile ready", flush=True)


if __name__ == "__main__":
    main()
