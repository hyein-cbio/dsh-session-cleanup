"""Driver regressions, not a substitute for a real live upstream run."""

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
        self.plugin = self.home / "plugin"
        self.cwd = self.home / "profile"
        self.cwd.mkdir()
        for path, name, version in (
            (self.harness / "apps/cli/package.json", "@deepseek-ai/dsh", "0.2.1-rc.5"),
            (self.tui / "package.json", "@deepseek-harness-tui/dsh-tui", "0.18.0"),
            (self.plugin / "package.json", "dsh-session-cleanup", "0.3.0-beta.1"),
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"name": name, "version": version}))
        self.workspace = self.home / "workspace.json"
        self.workspace.write_text("profile must not change")
        self.proj = self.home / "proj"
        self.proj.mkdir()
        self.patcher = patch.multiple(driver, ROOT=self.plugin, HOME=str(self.home), CWD=str(self.cwd),
                                      DSH=self.home / ".dsh",
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

    def test_candidate_pair_is_explicit_and_checks_its_own_sources(self):
        with patch.dict(os.environ, {
            "DSH_COMPAT_PAIR": "candidate-022",
            "DSH_COMPAT_BIN": str(self.harness / "apps/cli/lib/bin.js"),
            "DSH_COMPAT_HOME": str(self.home), "DSH_COMPAT_CWD": str(self.cwd),
            "DSH_COMPAT_HARNESS_ROOT": str(self.harness), "DSH_COMPAT_TUI_ROOT": str(self.tui),
        }):
            spec = importlib.util.spec_from_file_location("candidate_driver", ROOT / "scripts/live-upstream-tui.py")
            candidate = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(candidate)
        self.assertEqual(candidate.EXPECTED_HARNESS_HEAD, "66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db")
        self.assertEqual(candidate.EXPECTED_TUI_HEAD, "fb0b5325be7704fbdd09a7d7d8d642fca4d42f77")
        heads = {str(self.harness): candidate.EXPECTED_HARNESS_HEAD,
                 str(self.tui): candidate.EXPECTED_TUI_HEAD}
        with patch.object(candidate, "git_head", side_effect=lambda root: heads[root]):
            # Correct SHAs alone cannot bless a version mismatch.
            with self.assertRaises(SystemExit):
                candidate.validate_sources(candidate.Report())
            (self.harness / "apps/cli/package.json").write_text('{"version":"0.2.2-rc.1"}')
            report = candidate.Report()
            candidate.validate_sources(report)
            self.assertTrue(all(row["ok"] for row in report.rows))
            heads[str(self.tui)] = driver.EXPECTED_TUI_HEAD
            with self.assertRaises(SystemExit):
                candidate.validate_sources(candidate.Report())

    def test_sandbox_aliases_are_canonicalized_before_spawning(self):
        alias = self.home / "alias"
        alias.symlink_to(self.home, target_is_directory=True)
        with patch.dict(os.environ, {
            "DSH_COMPAT_PAIR": "validated", "DSH_COMPAT_BIN": "/unused/bin.js",
            "DSH_COMPAT_HOME": str(alias), "DSH_COMPAT_CWD": str(alias / "profile"),
        }):
            spec = importlib.util.spec_from_file_location("alias_driver", ROOT / "scripts/live-upstream-tui.py")
            aliased = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(aliased)
        self.assertEqual(aliased.HOME, str(self.home))
        self.assertEqual(aliased.CWD, str(self.cwd))

    def test_unknown_pair_is_refused_before_profile_changes(self):
        with patch.dict(os.environ, {"DSH_COMPAT_PAIR": "unreviewed-latest"}):
            spec = importlib.util.spec_from_file_location("unknown_driver", ROOT / "scripts/live-upstream-tui.py")
            unknown = importlib.util.module_from_spec(spec)
            with self.assertRaisesRegex(SystemExit, "unknown DSH_COMPAT_PAIR"):
                spec.loader.exec_module(unknown)
        self.assertEqual(self.workspace.read_text(), "profile must not change")

    def prepare_profile(self):
        sources = {key: json.loads((root / "package.json").read_text())
                   for key, root in (("plugin", self.plugin), ("tui", self.tui))}
        deps = {source["name"]: f"file:{self.home / (key + '.tgz')}" for key, source in sources.items()}
        (self.cwd / "package.json").write_text(json.dumps({"dependencies": deps}))
        installed = {}
        for key, source in sources.items():
            path = self.cwd / "node_modules" / source["name"] / "package.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(source))
            installed[key] = path
        return installed

    def test_installed_versions_follow_source_manifests_including_prereleases(self):
        for root, name, version in ((self.plugin, "@example/renamed-plugin", "1.2.0-beta.3"),
                                    (self.tui, "@example/renamed-tui", "0.19.0-rc.1")):
            (root / "package.json").write_text(json.dumps({"name": name, "version": version}))
        self.prepare_profile()
        driver.validate_profile(self.report)
        self.assertEqual([row["name"] for row in self.report.rows], ["profile-file-deps", "installed-versions"])
        self.assertTrue(all(row["ok"] for row in self.report.rows))

    def test_wrong_installed_version_fails_before_host_or_profile_changes(self):
        for key in ("plugin", "tui"):
            with self.subTest(key=key):
                installed = self.prepare_profile()
                manifest = json.loads(installed[key].read_text())
                manifest["version"] = "wrong"
                installed[key].write_text(json.dumps(manifest))
                with patch.object(driver.subprocess, "check_output", return_value="v22.23.4"):
                    self.assert_preflight_refuses("installed-versions")

    def test_wrong_installed_package_identity_is_refused(self):
        installed = self.prepare_profile()
        manifest = json.loads(installed["plugin"].read_text())
        manifest["name"] = "different-package"
        installed["plugin"].write_text(json.dumps(manifest))
        with self.assertRaises(SystemExit):
            driver.validate_profile(self.report)
        self.assertEqual(self.report.rows[-1]["name"], "installed-versions")
        self.assertFalse(self.report.rows[-1]["ok"])

    def test_registry_dependency_is_refused_before_host_or_profile_changes(self):
        self.prepare_profile()
        profile = self.cwd / "package.json"
        manifest = json.loads(profile.read_text())
        manifest["dependencies"]["dsh-session-cleanup"] = "latest"
        profile.write_text(json.dumps(manifest))
        with patch.object(driver.subprocess, "check_output", return_value="v22.23.4"):
            self.assert_preflight_refuses("profile-file-deps")

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

    def run_delete(self, *, publish_first=True, fail=False, retry=False, other_workspace=False, operation="rmSync"):
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
        if operation == "renameSync":
            delete = f"renameSync({json.dumps(str(target))}, {json.dumps(str(target) + '-trashed')});"
        elif operation == "trash-process":
            # A local executable fixture exercises the real spawn/close boundary,
            # without invoking Finder or depending on a desktop trash provider.
            provider = self.home / "trash"
            provider.write_text(f"#!{node}\nrequire('node:fs').renameSync(process.argv[2], process.argv[2] + '-trashed');\n")
            provider.chmod(0o755)
            env["PATH"] = str(self.home) + os.pathsep + env.get("PATH", "")
            delete = f"await new Promise((resolve, reject) => {{ const p = spawn('trash', [{json.dumps(str(target))}]); p.on('error', reject); p.on('close', code => code === 0 ? resolve() : reject(new Error(String(code)))); }});"
        elif operation == "missing-providers":
            # Exercise the real runner: ENOENT resolves on error, before close.
            # Keep every provider off PATH, then use the real filesystem fallback.
            empty_bin = self.home / "empty-bin"
            empty_bin.mkdir()
            env["PATH"] = str(empty_bin)
            trash = self.home / "Trash"
            trash.mkdir()
            env["DSH_SESSION_TRASH_DIR"] = str(trash)
            delete = (f"const {{ trashPath }} = await import({json.dumps((ROOT / 'lib/src/trash.js').as_uri())});"
                      f"const result = await trashPath({json.dumps(str(target))});"
                      "if (!result.ok) throw new Error(result.error);")
        script = 'import { rmSync, renameSync, writeFileSync } from "node:fs";\nimport { spawn } from "node:child_process";\n'
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

    def test_real_trash_rename_is_observed(self):
        target, events = self.run_delete(operation="renameSync")
        self.assertFalse(target.exists())
        self.assertTrue(Path(str(target) + "-trashed").is_dir())
        self.assertEqual([e["operation"] for e in events], ["renameSync", "renameSync"])
        self.assertTrue(driver.deletion_order_ok(events, [target], "adopted"))

    def test_trash_process_close_is_recorded_before_cleanup_continues(self):
        target, events = self.run_delete(operation="trash-process")
        self.assertFalse(target.exists())
        self.assertTrue(Path(str(target) + "-trashed").is_dir())
        self.assertEqual([e["operation"] for e in events], ["trash", "trash"])
        self.assertTrue(driver.deletion_order_ok(events, [target], "adopted"))

    def test_missing_trash_providers_complete_once_before_successful_fallback(self):
        target, events = self.run_delete(operation="missing-providers")
        operations = ["trash", "trash-put", "gio", "kioclient5", "kioclient", "osascript", "renameSync"]
        self.assertFalse(target.exists())
        self.assertEqual((self.home / "Trash" / target.name / "log.jsonl").read_text(), "{}\n")
        # The later close events must not duplicate error completions or overlap
        # the next provider's before-delete event.
        self.assertEqual(len(events), 2 * len(operations))
        for i, operation in enumerate(operations):
            before, after = events[2 * i:2 * i + 2]
            self.assertEqual([before["event"], after["event"]], ["before-delete", "after-delete"])
            self.assertEqual([before["operation"], after["operation"]], [operation, operation])
            self.assertTrue(before["exists"])
            self.assertEqual(after["exists"], operation != "renameSync")
        self.assertTrue(driver.deletion_order_ok(events, [target], "adopted"))

    def test_fresh_workspace_requires_boot_and_clean_exit(self):
        self.workspace.unlink()
        host = Mock()
        host.wait_ready.return_value = True
        def exit_host(_timeout):
            self.workspace.write_text("{}")
            return 0
        host.wait_exit.side_effect = exit_host
        with patch.object(driver, "Tui", return_value=host):
            driver.initialize_workspace(self.report)
        host.type_line.assert_called_once_with("/exit")
        host.close.assert_called_once()
        self.assertTrue(self.report.rows[-1]["ok"])

    def test_existing_workspace_does_not_boot_an_extra_host(self):
        with patch.object(driver, "Tui") as host:
            driver.initialize_workspace(self.report)
        host.assert_not_called()

    def test_workspace_initialization_fails_if_boot_fails(self):
        self.workspace.unlink()
        host = Mock()
        host.wait_ready.return_value = False
        with patch.object(driver, "Tui", return_value=host), self.assertRaises(SystemExit):
            driver.initialize_workspace(self.report)
        host.close.assert_called_once()
        host.type_line.assert_not_called()

    def test_ready_dismisses_fresh_onboarding_without_credentials(self):
        host = object.__new__(driver.Tui)
        host.exit_code = None
        host.seen = Mock(side_effect=[False, True, False, True])
        host.key = Mock()
        self.assertTrue(host.wait_ready())
        host.key.assert_called_once_with(b"\x1b")

    def test_macos_process_proof_uses_ps_and_lsof(self):
        with patch.object(driver.sys, "platform", "darwin"), patch.object(driver.subprocess, "check_output", side_effect=[
            "node /source/apps/cli/lib/bin.js\n", "p123\nn/source/native/system/system.node\nn/unrelated\n",
        ]) as run:
            proof = driver.proc_proof(123)
        self.assertEqual(proof["cmdline"], "node /source/apps/cli/lib/bin.js")
        self.assertEqual(proof["maps"], ["/source/native/system/system.node"])
        self.assertEqual(run.call_count, 2)

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
