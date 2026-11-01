"""Driver regressions, not a substitute for the Linux live upstream run."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
with patch.dict(os.environ, {
    "DSH_COMPAT_BIN": "/unused/bin.js",
    "DSH_COMPAT_HOME": "/unused/home",
    "DSH_COMPAT_CWD": "/unused/home/profile",
}):
    spec = importlib.util.spec_from_file_location("live_upstream_tui", ROOT / "scripts/live-upstream-tui.py")
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.harness = self.home / "harness"
        self.tui = self.home / "tui"
        self.cwd = self.home / "profile"
        self.cwd.mkdir()
        for path, version in (
            (self.harness / "apps/cli/package.json", "0.2.1-rc.5"),
            (self.tui / "package.json", "0.18.0"),
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"version": version}))
        self.workspace = self.home / "workspace.json"
        self.workspace.write_text("profile must not change")
        self.proj = self.home / "proj"
        self.proj.mkdir()
        self.patcher = patch.multiple(driver, HOME=str(self.home), CWD=str(self.cwd),
                                      HARNESS=str(self.harness), TUI_ROOT=str(self.tui),
                                      BIN=str(self.harness / "apps/cli/lib/bin.js"),
                                      WORKSPACE=self.workspace, PROJ=self.proj, LOG=self.home / "logs")
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.heads = {str(self.harness): driver.EXPECTED_HARNESS_HEAD,
                      str(self.tui): driver.EXPECTED_TUI_HEAD}
        self.git = patch.object(driver, "git_head", side_effect=lambda root: self.heads[root])
        self.git.start()
        self.addCleanup(self.git.stop)
        self.report = driver.Report()

    def assert_preflight_refuses(self, assertion):
        with patch.object(driver, "Tui") as host, patch.object(driver, "set_lists") as mutate:
            with self.assertRaises(SystemExit):
                driver.main()
        host.assert_not_called()
        mutate.assert_not_called()
        self.assertEqual(self.workspace.read_text(), "profile must not change")
        report = json.loads((driver.LOG / "live-full.json").read_text())
        self.assertEqual(report["assertions"][-1]["name"], assertion)
        self.assertEqual(report["failed"], 1)

    def test_both_source_roots_are_required_before_profile_changes(self):
        for missing in ("HARNESS", "TUI_ROOT"):
            with self.subTest(missing=missing), patch.object(driver, missing, ""):
                self.assert_preflight_refuses("source-roots")

    def test_other_commits_are_refused_even_with_matching_versions(self):
        for name, root in (("harness", self.harness), ("tui", self.tui)):
            with self.subTest(name=name), patch.dict(self.heads, {str(root): "a" * 40}):
                self.assert_preflight_refuses(f"{name}-commit")

    def test_unreadable_checkout_is_refused(self):
        with patch.dict(self.heads, {str(self.harness): ""}):
            self.assert_preflight_refuses("harness-commit")

    def test_wrong_source_versions_are_refused(self):
        for path in (self.harness / "apps/cli/package.json", self.tui / "package.json"):
            original = path.read_text()
            with self.subTest(path=path):
                path.write_text('{"version":"wrong"}')
                self.assert_preflight_refuses("source-versions")
            path.write_text(original)

    def test_host_path_prefix_is_not_checkout_identity(self):
        with patch.object(driver, "BIN", str(self.harness) + "-other/apps/cli/lib/bin.js"):
            self.assert_preflight_refuses("host-checkout")

    def test_expected_sources_pass_and_record_heads(self):
        driver.validate_sources(self.report)
        self.assertTrue(all(row["ok"] for row in self.report.rows))
        self.assertEqual(self.report.provenance, {
            "harnessHead": driver.EXPECTED_HARNESS_HEAD, "tuiHead": driver.EXPECTED_TUI_HEAD,
        })

    def test_missing_projection_refuses_confirmation(self):
        host = Mock()
        with self.assertRaises(SystemExit):
            driver.confirm_switch(host, self.report, "doomed", [])
        host.key.assert_not_called()
        self.assertEqual(self.report.rows[-1]["name"], "switch-proj-before")

    def test_existing_projection_allows_confirmation(self):
        (self.proj / "doomed.json").write_text("{}")
        host = Mock()
        driver.confirm_switch(host, self.report, "doomed", [])
        host.key.assert_called_once_with(b"\r")
        self.assertTrue(self.report.rows[-1]["ok"])

    def run_delete(self, *, publish_first=True, fail=False, retry=False, other_workspace=False):
        node = os.environ.get("DSH_COMPAT_NODE") or shutil.which("node")
        self.assertTrue(node, "Node is required to exercise the real deletion observer")
        target = self.home / "sessions/project/doomed"
        target.mkdir(parents=True)
        (target / "log.jsonl").write_text("{}\n")
        unrelated = self.home / "unrelated"
        unrelated.mkdir()
        trace = self.home / "trace.jsonl"
        env = {**os.environ, "DSH_COMPAT_CWD": str(self.cwd),
               "DSH_COMPAT_DELETE_TARGETS": json.dumps([str(target)]),
               "DSH_COMPAT_DELETE_TRACE": str(trace),
               "DSH_COMPAT_DELETE_WORKSPACE": str(self.workspace)}
        data = {"tables": {"workspaces": {"current": {"path": str(self.cwd), "sessionIds": ["doomed"]}}}}
        self.workspace.write_text(json.dumps(data))
        data["tables"]["workspaces"]["current"]["sessionIds"].append("adopted")
        if other_workspace:
            data["tables"]["workspaces"]["current"]["sessionIds"] = ["doomed"]
            data["tables"]["workspaces"]["other"] = {"path": str(self.home), "sessionIds": ["adopted"]}
        publish = f"writeFileSync({json.dumps(str(self.workspace))}, {json.dumps(json.dumps(data))});"
        delete = f"rmSync({json.dumps(str(target))}, {{recursive: {str(not fail).lower()}}});"
        if retry:
            delete = f"try {{ rmSync({json.dumps(str(target))}); }} catch {{}}" + delete
        script = 'import { rmSync, writeFileSync } from "node:fs";\n'
        script += f"rmSync({json.dumps(str(unrelated))}, {{recursive: true}});\n"
        script += publish + delete if publish_first else delete + publish
        result = subprocess.run([node, "--require", str(driver.DELETE_OBSERVER), "--input-type=module", "-e", script],
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, not fail, result.stderr)
        events = [json.loads(line) for line in trace.read_text().splitlines()]
        return target, events

    def test_immediate_switch_and_delete_pass_when_observed_after_completion(self):
        target, events = self.run_delete()
        self.assertFalse(target.exists())
        self.assertEqual(len(events), 2)  # Unrelated deletions were not recorded.
        self.assertTrue(driver.deletion_order_ok(events, [target], "adopted"))

    def test_deletion_before_publication_fails(self):
        target, events = self.run_delete(publish_first=False)
        self.assertFalse(driver.deletion_order_ok(events, [target], "adopted"))

    def test_new_id_in_another_workspace_does_not_prove_switch(self):
        target, events = self.run_delete(other_workspace=True)
        self.assertFalse(driver.deletion_order_ok(events, [target], "adopted"))

    def test_failed_delete_cannot_pass_order_check(self):
        target, events = self.run_delete(fail=True)
        self.assertTrue(target.exists())
        self.assertEqual(len(events), 2)
        self.assertFalse(driver.deletion_order_ok(events, [target], "adopted"))

    def test_successful_retry_preserves_order_evidence(self):
        target, events = self.run_delete(retry=True)
        self.assertFalse(target.exists())
        self.assertEqual(len(events), 4)
        self.assertTrue(events[1]["exists"])
        self.assertFalse(events[3]["exists"])
        self.assertTrue(driver.deletion_order_ok(events, [target], "adopted"))

    def test_missing_wrong_reversed_or_truncated_events_fail_closed(self):
        target, events = self.run_delete()
        for broken in ([], events[:1], list(reversed(events)), events + events[:1]):
            with self.subTest(events=broken):
                self.assertFalse(driver.deletion_order_ok(broken, [target], "adopted"))
        self.assertFalse(driver.deletion_order_ok(events, [], "adopted"))
        self.assertFalse(driver.deletion_order_ok(events, [target], "other-id"))
        self.assertFalse(driver.deletion_order_ok(events, [target, target.parent / "missing"], "adopted"))


if __name__ == "__main__":
    unittest.main()
