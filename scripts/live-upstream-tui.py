#!/usr/bin/env python3
"""Drive the real dsh-tui PTY through /nix for one source-built upstream pair.

The host and TUI are the processes under test. This script does not mock
scenes, commands, or session deletion. Every path it asks the TUI to delete
must already resolve under the disposable HOME.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import platform
import select
import struct
import subprocess
import sys
import termios
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pty_screen import Screen
from upstream_pairs import selected_pair

UPSTREAM_PAIR = selected_pair()
ROOT = Path(__file__).resolve().parents[1]
CLI = os.environ.get("DSH_COMPAT_NODE", "/exec-daemon/node")
BIN = os.environ["DSH_COMPAT_BIN"]
# Give the host and deletion observer the same spelling (e.g. macOS /tmp is
# /private/tmp). Otherwise real deletion can be invisible to the trace matcher.
HOME = os.path.realpath(os.environ["DSH_COMPAT_HOME"])
CWD = os.path.realpath(os.environ["DSH_COMPAT_CWD"])
PROFILE = os.environ.get("DSH_COMPAT_PROFILE", "dsh-tui")
DSH = Path(HOME) / ".dsh"
WORKSPACE = DSH / "storages" / "workspace.json"
PROJ = DSH / "storages" / "session_projcache" / "sessions"
SESSIONS = DSH / "sessions"
LOG = Path(os.environ.get("DSH_COMPAT_LOG", "/tmp/compat-src/live-run"))
HARNESS = os.environ.get("DSH_COMPAT_HARNESS_ROOT", "")
TUI_ROOT = os.environ.get("DSH_COMPAT_TUI_ROOT", "")
EXPECTED_HARNESS_HEAD = UPSTREAM_PAIR["harness_ref"]
EXPECTED_TUI_HEAD = UPSTREAM_PAIR["tui_ref"]
DELETE_TRACE = LOG / "switch-deletions.jsonl"
DELETE_OBSERVER = Path(__file__).with_name("observe-session-delete.cjs").resolve()
ROWS, COLS = 42, 120
SECRET_MARKERS = ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL")


def scrub(env: dict[str, str]) -> dict[str, str]:
    return {k: v for k, v in env.items() if not any(m in k.upper() for m in SECRET_MARKERS)}


def sandbox_ok(path: str) -> bool:
    real = os.path.realpath(path)
    home = os.path.realpath(HOME)
    return real == home or real.startswith(home + os.sep)


class Tui:
    def __init__(self, args: list[str], *, observe_deletions: list[Path] | None = None) -> None:
        self.master, slave = os.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
        self.pid = os.fork()
        if self.pid == 0:
            os.setsid()
            os.dup2(slave, 0)
            os.dup2(slave, 1)
            os.dup2(slave, 2)
            if slave > 2:
                os.close(slave)
            os.close(self.master)
            os.chdir(CWD)
            env = scrub(os.environ.copy())
            env.update({
                "HOME": HOME,
                "DSH_HOME": str(DSH),
                "XDG_CONFIG_HOME": f"{HOME}/.config",
                "XDG_DATA_HOME": f"{HOME}/.local/share",
                "XDG_CACHE_HOME": f"{HOME}/.cache",
                "XDG_STATE_HOME": f"{HOME}/.local/state",
                "TERM": "xterm-256color",
                "COLUMNS": str(COLS),
                "LINES": str(ROWS),
                "DSH_TUI_NO_LAUNCHPAD": "1",
                "NO_COLOR": "1",
                # Headless macOS may need the real filesystem Trash fallback.
                "DSH_SESSION_TRASH_DIR": str(Path(HOME) / ".Trash"),
            })
            node_args: list[str] = []
            if observe_deletions:
                env.update({
                    "DSH_COMPAT_DELETE_TARGETS": json.dumps([str(p.resolve()) for p in observe_deletions]),
                    "DSH_COMPAT_DELETE_TRACE": str(DELETE_TRACE.resolve()),
                    "DSH_COMPAT_DELETE_WORKSPACE": str(WORKSPACE.resolve()),
                })
                node_args = ["--require", str(DELETE_OBSERVER)]
            os.execve(CLI, [CLI, *node_args, BIN, "--profile", PROFILE, *args], env)
            raise SystemExit(127)
        os.close(slave)
        self.screen = Screen(ROWS, COLS)
        self.raw = bytearray()
        self.lock = threading.Lock()
        self.exit_code: int | None = None
        self._stop = False
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self) -> None:
        while not self._stop:
            ready, _, _ = select.select([self.master], [], [], 0.1)
            if not ready:
                continue
            try:
                chunk = os.read(self.master, 65536)
            except OSError:
                break
            if not chunk:
                break
            with self.lock:
                self.raw.extend(chunk)
                self.screen.feed(chunk.decode("utf-8", "replace"))
        try:
            _pid, status = os.waitpid(self.pid, 0)
        except ChildProcessError:
            status = -1
        if os.WIFEXITED(status):
            self.exit_code = os.WEXITSTATUS(status)
        elif os.WIFSIGNALED(status):
            self.exit_code = 128 + os.WTERMSIG(status)
        else:
            self.exit_code = status

    def text(self) -> str:
        with self.lock:
            return self.screen.text()

    def raw_text(self) -> str:
        with self.lock:
            return self.raw.decode("utf-8", "replace")

    def seen(self, needle: str) -> bool:
        return needle in self.raw_text() or needle in self.text()

    def count(self, needle: str) -> int:
        return self.raw_text().count(needle)

    def wait(self, needle: str, timeout: float) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if self.seen(needle):
                return True
            if self.exit_code is not None:
                return self.seen(needle)
            time.sleep(0.05)
        return self.seen(needle)

    def wait_ready(self, timeout: float = 30) -> bool:
        # A fresh, credential-free profile first shows the onboarding guide.
        # Dismiss it through its real Escape action; never sign in or call a model.
        end = time.monotonic() + timeout
        dismissed = False
        closed_sessions = False
        while time.monotonic() < end:
            if self.seen("Context loaded"):
                return True
            if not dismissed and self.seen("Welcome to dsh-TUI"):
                self.key(b"\x1b")
                dismissed = True
            if not closed_sessions and self.seen("This terminal hosts several sessions"):
                self.key(b"\x1b")
                closed_sessions = True
            if self.exit_code is not None:
                return False
            time.sleep(0.05)
        return self.seen("Context loaded")

    def wait_exit(self, timeout: float) -> int | None:
        end = time.time() + timeout
        while time.time() < end:
            if self.exit_code is not None:
                return self.exit_code
            time.sleep(0.05)
        return self.exit_code

    def type_line(self, line: str) -> None:
        for ch in line:
            os.write(self.master, ch.encode())
            time.sleep(0.03)
        time.sleep(0.2)
        os.write(self.master, b"\r")

    def key(self, data: bytes) -> None:
        os.write(self.master, data)
        time.sleep(0.12)

    def dump(self, name: str) -> None:
        LOG.mkdir(parents=True, exist_ok=True)
        (LOG / f"{name}.screen.txt").write_text(self.text())
        with self.lock:
            (LOG / f"{name}.raw.txt").write_bytes(bytes(self.raw))

    def close(self) -> int:
        if self.exit_code is None:
            try:
                os.kill(self.pid, 15)
            except ProcessLookupError:
                pass
            for _ in range(40):
                if self.exit_code is not None:
                    break
                time.sleep(0.1)
            if self.exit_code is None:
                try:
                    os.kill(self.pid, 9)
                except ProcessLookupError:
                    pass
        self._stop = True
        try:
            os.close(self.master)
        except OSError:
            pass
        self.thread.join(timeout=2)
        return self.exit_code if self.exit_code is not None else -1


def workspace() -> dict:
    return json.loads(WORKSPACE.read_text())


def profile_ids() -> list[str]:
    ids: list[str] = []
    for record in workspace()["tables"]["workspaces"].values():
        if os.path.realpath(record.get("path", "")) == os.path.realpath(CWD):
            ids.extend(record.get("sessionIds") or [])
    return ids


def global_lists() -> dict:
    g = workspace()["global"]
    return {
        "pinned": list(g.get("pinnedSessionIds") or []),
        "archived": list(g.get("archivedSessionIds") or []),
    }


def set_lists(pinned: list[str], archived: list[str]) -> None:
    data = workspace()
    data["global"]["pinnedSessionIds"] = pinned
    data["global"]["archivedSessionIds"] = archived
    WORKSPACE.write_text(json.dumps(data, indent=2) + "\n")


def proj_has(sid: str) -> bool:
    return (PROJ / f"{sid}.json").exists()


def session_dirs(sid: str) -> list[Path]:
    found: list[Path] = []
    if not SESSIONS.exists():
        return found
    for project in SESSIONS.iterdir():
        if not project.is_dir():
            continue
        for variant in (sid, f"session-{sid}"):
            candidate = project / variant
            if candidate.exists():
                found.append(candidate)
    return found


def log_files(sid: str) -> list[Path]:
    files: list[Path] = []
    for directory in session_dirs(sid):
        if not directory.is_dir():
            continue
        for child in directory.iterdir():
            if child.is_file() and "jsonl" in child.name:
                files.append(child)
    return files


def log_digest(sid: str) -> str | None:
    files = log_files(sid)
    if not files:
        return None
    h = hashlib.sha256()
    for path in sorted(files):
        h.update(path.name.encode())
        h.update(path.read_bytes())
    return h.hexdigest()


def require_sandbox(paths: list[Path]) -> None:
    for path in paths:
        if not sandbox_ok(str(path)):
            raise SystemExit(f"REFUSE destructive path outside sandbox: {path}")


class Report:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.notes: list[str] = []
        self.provenance: dict = {}

    def add(self, name: str, ok: bool, detail: str) -> None:
        self.rows.append({"name": name, "ok": ok, "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)
        if not ok:
            self.flush()
            raise SystemExit(1)

    def flush(self) -> None:
        LOG.mkdir(parents=True, exist_ok=True)
        passed = sum(1 for row in self.rows if row["ok"])
        failed = sum(1 for row in self.rows if not row["ok"])
        payload = {
            "passed": passed,
            "failed": failed,
            "skipped": 0,
            "notes": self.notes,
            "provenance": self.provenance,
            "assertions": self.rows,
        }
        (LOG / "live-full.json").write_text(json.dumps(payload, indent=2) + "\n")


def proc_proof(pid: int) -> dict:
    if sys.platform == "darwin":
        cmd = subprocess.check_output(["ps", "-ww", "-p", str(pid), "-o", "command="], text=True).strip()
        files = subprocess.check_output(["lsof", "-a", "-p", str(pid), "-Fn"], text=True)
        hits = [line[1:] for line in files.splitlines() if line.startswith("n") and "system.node" in line]
        return {"cmdline": cmd, "maps": sorted(set(hits))}
    cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode()
    maps = Path(f"/proc/{pid}/maps").read_text(errors="replace")
    hits = []
    for line in maps.splitlines():
        if "system.node" in line or "apps/cli/lib/bin.js" in line or "session-persistence-jsonl" in line:
            hits.append(line.split()[-1])
    return {"cmdline": cmd, "maps": sorted(set(hits))}


def git_head(root: str) -> str:
    if not root:
        return ""
    result = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def validate_sources(report: Report) -> None:
    # Fail before reading or changing the disposable profile, not just at report time.
    report.add("source-roots", bool(HARNESS and TUI_ROOT),
               "DSH_COMPAT_HARNESS_ROOT and DSH_COMPAT_TUI_ROOT are required")
    for name, root, expected in (
        ("harness", HARNESS, EXPECTED_HARNESS_HEAD),
        ("tui", TUI_ROOT, EXPECTED_TUI_HEAD),
    ):
        head = git_head(root)
        report.provenance[f"{name}Head"] = head
        report.add(f"{name}-commit", head == expected, f"expected={expected} actual={head}")
    harness_pkg = json.loads((Path(HARNESS) / "apps/cli/package.json").read_text())
    tui_pkg = json.loads((Path(TUI_ROOT) / "package.json").read_text())
    report.add("source-versions",
               harness_pkg.get("version") == UPSTREAM_PAIR["harness_version"]
               and tui_pkg.get("version") == UPSTREAM_PAIR["tui_version"],
               f"harness {harness_pkg.get('version')} tui {tui_pkg.get('version')}")
    report.add("host-checkout", Path(BIN).resolve() == (Path(HARNESS) / "apps/cli/lib/bin.js").resolve(), BIN)


def confirm_switch(tui: Tui, report: Report, doomed: str, targets: list[Path]) -> None:
    require_sandbox(targets)
    report.add("switch-proj-before", proj_has(doomed), f"projection cache must exist for {doomed}")
    tui.key(b"\r")


def deletion_order_ok(events: list[dict], targets: list[Path], adopted: str) -> bool:
    # Inspect durable boundary events; no polling thread has to see a transient overlap.
    if not targets:
        return False
    for target in targets:
        matching = [event for event in events if event.get("target") == str(target.resolve())]
        if not matching or len(matching) % 2:
            return False
        # Cleanup may retry a failed removal or remove a recreated directory.
        # Every attempt must follow adoption; the final attempt must remove it.
        for before, after in zip(matching[::2], matching[1::2]):
            if not (before.get("event") == "before-delete" and before.get("exists") is True
                    and adopted in before.get("ids", [])
                    and after.get("event") == "after-delete" and isinstance(after.get("exists"), bool)):
                return False
        if matching[-1]["exists"]:
            return False
    return True


def initialize_workspace(report: Report) -> None:
    if WORKSPACE.exists():
        return
    tui = Tui([])
    try:
        ready = tui.wait_ready()
        if not ready:
            tui.dump("initialize-fail")
            report.add("initialize-workspace", False, "fresh profile did not reach the composer")
        tui.type_line("/exit")
        code = tui.wait_exit(15)
        report.add("initialize-workspace", code == 0 and WORKSPACE.is_file(), f"exit={code}")
    finally:
        tui.close()


def validate_profile(report: Report) -> None:
    sources = {
        "plugin": json.loads((ROOT / "package.json").read_text()),
        "tui": json.loads((Path(TUI_ROOT) / "package.json").read_text()),
    }
    profile_pkg = json.loads((Path(CWD) / "package.json").read_text())
    deps = profile_pkg.get("dependencies") or {}
    file_deps = {name: spec for name, spec in deps.items() if str(spec).startswith("file:")}
    registry = {name: spec for name, spec in deps.items() if not str(spec).startswith("file:")}
    report.add(
        "profile-file-deps",
        not registry and all(source["name"] in file_deps for source in sources.values()),
        json.dumps(deps),
    )
    installed = {
        key: json.loads((Path(CWD) / "node_modules" / source["name"] / "package.json").read_text())
        for key, source in sources.items()
    }
    report.add(
        "installed-versions",
        all(installed[key].get("name") == source["name"]
            and bool(source.get("version"))
            and installed[key].get("version") == source["version"]
            for key, source in sources.items()),
        "; ".join(f"{key} expected={source['name']}@{source.get('version')} "
                  f"actual={installed[key].get('name')}@{installed[key].get('version')}"
                  for key, source in sources.items()),
    )


def main() -> None:
    report = Report()
    validate_sources(report)
    report.provenance.update({
        "node": subprocess.check_output([CLI, "-v"], text=True).strip(),
        "uname": " ".join(platform.uname()),
        "hostNode": CLI,
    })
    if not sandbox_ok(str(DSH)) or not sandbox_ok(CWD):
        raise SystemExit("sandbox paths are not under HOME")
    validate_profile(report)
    (Path(HOME) / ".Trash").mkdir(parents=True, exist_ok=True)
    initialize_workspace(report)
    set_lists([], [])

    tui = Tui([])
    control = ""
    doomed = ""
    control_digest = ""
    try:
        if not tui.wait_ready():
            tui.dump("boot-fail")
            report.add("boot", False, "composer did not become ready")
        report.add("boot", True, "chat composer ready")
        proof = proc_proof(tui.pid)
        host_ok = BIN in proof["cmdline"] and CLI in proof["cmdline"]
        report.add("host-cmdline", host_ok, proof["cmdline"])

        tui.type_line("/nix help")
        if not tui.wait("Usage: /nix", 10):
            tui.dump("help-fail")
            report.add("help", False, "usage text missing")
        report.add("help", True, "Usage: /nix rendered")

        before_ids = profile_ids()
        before_dirs = {sid: [str(p) for p in session_dirs(sid)] for sid in before_ids}
        before_digest = {sid: log_digest(sid) for sid in before_ids}
        tui.type_line("/nix")
        if not tui.wait("Delete this session and start a new one?", 10):
            tui.dump("confirm-fail")
            report.add("confirm-dialog", False, "confirmation did not open")
        report.add("confirm-dialog", True, "confirmation open")
        tui.key(b"\x1b[B")
        tui.key(b"\r")
        if not tui.wait("/nix cancelled", 10):
            tui.dump("cancel-fail")
            report.add("cancel", False, "cancel text missing")
        after_ids = profile_ids()
        if any(sid not in after_ids for sid in before_ids):
            report.add("cancel", False, f"ids dropped {before_ids} -> {after_ids}")
        for sid, digest in before_digest.items():
            if digest is not None and log_digest(sid) != digest:
                report.add("cancel", False, f"log changed for {sid}")
            if before_dirs.get(sid) and not session_dirs(sid):
                report.add("cancel", False, f"directory removed on cancel for {sid}")
        report.add("cancel", True, f"ids kept {after_ids}")

        stamps = {sid: log_digest(sid) for sid in profile_ids()}
        tui.type_line("/rename control-keep")
        if not tui.wait('Renamed to "control-keep"', 10):
            tui.dump("rename-control-fail")
            report.add("rename-control", False, "rename text missing")
        deadline = time.time() + 8
        changed: list[str] = []
        while time.time() < deadline:
            changed = [sid for sid in profile_ids() if log_digest(sid) != stamps.get(sid)]
            if len(changed) == 1 and log_files(changed[0]):
                break
            time.sleep(0.1)
        if len(changed) != 1:
            tui.dump("rename-control-ambiguous")
            report.add("rename-control", False, f"changed={changed} ids={profile_ids()}")
        control = changed[0]
        control_digest = log_digest(control) or ""
        require_sandbox(session_dirs(control))
        report.add("rename-control", True, control)

        proof = proc_proof(tui.pid)
        addon = [hit for hit in proof["maps"] if hit.endswith("system.node")]
        addon_ok = bool(addon) and all(Path(hit).resolve().is_relative_to(Path(HARNESS).resolve()) for hit in addon)
        report.add("flock-addon", addon_ok, json.dumps(addon))

        prev = set(profile_ids())
        tui.type_line("/new")
        if not tui.wait("New session started", 10):
            tui.dump("new-fail")
            report.add("new", False, "new session notice missing")
        deadline = time.time() + 8
        created: list[str] = []
        while time.time() < deadline:
            created = [sid for sid in profile_ids() if sid not in prev]
            if created:
                break
            time.sleep(0.1)
        if len(created) != 1 or control not in profile_ids():
            report.add("new", False, f"created={created} ids={profile_ids()}")
        doomed = created[0]
        report.add("new", True, f"doomed={doomed} control={control}")

        tui.type_line("/rename doomed-drop")
        if not tui.wait('Renamed to "doomed-drop"', 10):
            tui.dump("rename-doomed-fail")
            report.add("rename-doomed", False, "rename text missing")
        deadline = time.time() + 8
        while time.time() < deadline and not log_files(doomed):
            time.sleep(0.1)
        if not log_files(doomed):
            tui.dump("rename-doomed-nolog")
            report.add("rename-doomed", False, "doomed session log was not published")
        require_sandbox(session_dirs(doomed))
        report.add("rename-doomed", True, str(session_dirs(doomed)[0]))
        tui.type_line("/exit")
        code = tui.wait_exit(15)
        if code != 0:
            tui.dump("exit-setup-fail")
            report.add("exit-setup", False, f"exit={code}")
        report.add("exit-setup", True, "exit 0")
    finally:
        if tui.exit_code is None:
            tui.close()
        else:
            tui.close()

    set_lists([doomed, control], [doomed])
    if log_digest(control) != control_digest:
        report.add("control-stable-before-resume", False, "control log changed while stopped")
    report.add("control-stable-before-resume", True, control_digest[:12])

    delete_targets = session_dirs(doomed)
    require_sandbox(delete_targets)
    report.add("switch-targets", bool(delete_targets), "doomed session directory exists before resume")
    LOG.mkdir(parents=True, exist_ok=True)
    DELETE_TRACE.write_text("")
    tui = Tui(["--resume", doomed], observe_deletions=delete_targets)
    adopted = ""
    try:
        if not tui.wait_ready():
            tui.dump("resume-fail")
            report.add("resume", False, tui.raw_text()[-1500:])
        if doomed not in profile_ids() or control not in profile_ids():
            report.add("resume", False, f"ids={profile_ids()}")
        lists = global_lists()
        if doomed not in lists["pinned"] or control not in lists["pinned"] or doomed not in lists["archived"]:
            report.add("resume", False, f"lists were not loaded {lists}")
        report.add("resume", True, f"resumed {doomed} pins={lists['pinned']}")

        pre_ids = set(profile_ids())
        tui.type_line("/nix")
        if not tui.wait("Delete this session and start a new one?", 10):
            tui.dump("switch-dialog-fail")
            report.add("switch-dialog", False, "confirmation missing on resume")
        report.add("switch-dialog", True, "confirmation open for doomed session")
        confirm_switch(tui, report, doomed, session_dirs(doomed) + session_dirs(control))
        if not tui.wait("Previous session deleted", 15):
            tui.dump("switch-fail")
            report.add("switch", False, "deletion summary missing")

        now = profile_ids()
        adopted_ids = [sid for sid in now if sid not in pre_ids]
        if len(adopted_ids) != 1 or doomed in now or control not in now:
            report.add("switch-ids", False, f"now={now} pre={sorted(pre_ids)}")
        adopted = adopted_ids[0]
        events = [json.loads(line) for line in DELETE_TRACE.read_text().splitlines()]
        report.add("switch-order", deletion_order_ok(events, delete_targets, adopted), json.dumps(events))
        if sys.platform == "darwin":
            report.add("switch-trash", all(event.get("operation") != "rmSync" for event in events),
                       "macOS used Trash operations, not permanent removal")
        if session_dirs(doomed):
            report.add("switch-dir", False, "doomed directory still present")
        if not session_dirs(control) or log_digest(control) != control_digest:
            report.add("switch-control", False, "control session changed during /nix")
        report.add("switch-proj", not proj_has(doomed), "doomed projection cache removed")
        lists = global_lists()
        if doomed in lists["pinned"] or doomed in lists["archived"] or control not in lists["pinned"]:
            report.add("switch-lists", False, json.dumps(lists))
        report.add("switch", True, f"adopted={adopted} doomed removed control kept")

        seen_usage_before = tui.seen("Usage: /nix")
        tui.type_line("/nix help")
        deadline = time.time() + 10
        while time.time() < deadline:
            if tui.seen("Usage: /nix") and (not seen_usage_before or tui.count("Usage: /nix") > 0):
                break
            if tui.exit_code is not None:
                break
            time.sleep(0.05)
        if not tui.seen("Usage: /nix"):
            tui.dump("usable-fail")
            report.add("usable", False, "adopted session did not render /nix help")
        report.add("usable", True, "adopted session accepted /nix help")

        tui.type_line("/nix quit")
        if not tui.wait("Delete the current session?", 10):
            tui.dump("quit-dialog-fail")
            report.add("quit-dialog", False, "quit confirmation missing")
        report.add("quit-dialog", True, "quit confirmation open")
        require_sandbox(session_dirs(adopted) + session_dirs(control))
        tui.key(b"\r")
        code = tui.wait_exit(20)
        if code != 0:
            tui.dump("quit-fail")
            report.add("quit", False, f"exit={code} raw={tui.raw_text()[-800:]}")
        report.add("quit", True, "exit 0")
    finally:
        if tui.exit_code is None:
            tui.close()
        else:
            tui.close()

    if session_dirs(adopted):
        report.add("quit-adopted-dir", False, "adopted directory remains after quit")
    if adopted in profile_ids() or doomed in profile_ids():
        report.add("quit-ids", False, f"ids={profile_ids()}")
    if not session_dirs(control) or log_digest(control) != control_digest:
        report.add("quit-control", False, "control session changed during quit")
    lists = global_lists()
    if adopted in lists["pinned"] or adopted in lists["archived"] or doomed in lists["pinned"] or doomed in lists["archived"]:
        report.add("quit-lists", False, json.dumps(lists))
    if control not in lists["pinned"] or control not in profile_ids():
        report.add("quit-control-list", False, json.dumps({"ids": profile_ids(), "lists": lists}))
    report.add("quit-cleanup", True, "adopted removed, control remains, deleted ids not recreated")

    tui = Tui([])
    try:
        if not tui.wait_ready():
            tui.dump("restart-fail")
            report.add("restart-boot", False, "restart did not reach the composer")
        ids = profile_ids()
        if doomed in ids or adopted in ids or control not in ids:
            report.add("restart-ids", False, f"ids={ids}")
        if session_dirs(doomed) or session_dirs(adopted):
            report.add("restart-dirs", False, "deleted session directory came back")
        if not session_dirs(control) or log_digest(control) != control_digest:
            report.add("restart-control", False, "control session changed across restart")
        report.add("restart", True, f"deleted ids stay gone; control {control} remains")
        tui.type_line("/exit")
        code = tui.wait_exit(15)
        report.add("restart-exit", code == 0, f"exit={code}")
    finally:
        if tui.exit_code is None:
            tui.close()
        else:
            tui.close()

    report.notes.append(
        "The live TUI exposed the switch scene, so confirmed /nix adopted a new session before deleting the old one. "
        "The refuse-without-delete branch applies only when that scene is missing. This run did not disable it. "
        "Unit test \"DSH /nix does not delete when the TUI refuses to switch\" covers that branch with a stubbed switch result."
    )
    report.flush()
    print("LIVE_OK", flush=True)


if __name__ == "__main__":
    main()
