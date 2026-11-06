"""Offline cloud-CI contracts: no SDK, credentials or billable resources."""

import json
from pathlib import Path
import subprocess
import sys
from threading import Barrier, Lock
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ci"))
import modal_ci as ci
import run_ci as worker
from settings import evidence_path, validate_cell


class SourceTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "repo"
        self.root.mkdir()
        self.staging = self.base / "upload"
        self.staging.mkdir()
        self.git("init", "-q")
        (self.root / "package.json").write_text('{"name":"fixture","version":"1.0.0"}')
        (self.root / "package-lock.json").write_text('{"lockfileVersion":3}')
        (self.root / ".gitignore").write_text("ignored/\n")
        self.commit("Initial")
        self.old_head = self.git("rev-parse", "HEAD").strip()
        (self.root / "history.txt").write_text("Historical source")
        self.commit("History")

    def git(self, *args):
        return ci.git(self.root, *args).decode()

    def commit(self, message):
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-qm", message)

    def test_bundle_contains_committed_history_not_local_files_or_credentials(self):
        (self.root / ".env").write_text("SECRET=do-not-upload")
        (self.root / "ignored").mkdir()
        (self.root / "ignored/receipt.json").write_text("do-not-upload")
        self.git("config", "http.extraheader", "Authorization: do-not-upload")
        self.git("remote", "add", "origin", "https://do-not-upload@example.invalid/repo")
        head = ci.prepare_source(self.root, self.staging)
        clone = self.base / "clone"
        subprocess.run(["git", "clone", "-q", str(self.staging / "source.bundle"), str(clone)],
                       check=True, capture_output=True)
        self.assertEqual(ci.git(clone, "rev-parse", "HEAD").decode().strip(), head)
        self.assertEqual(ci.git(clone, "show", f"{self.old_head}:package.json"),
                         (self.staging / "package.json").read_bytes())
        self.assertFalse((clone / ".env").exists())
        self.assertFalse((clone / "ignored").exists())
        self.assertNotIn("do-not-upload", (clone / ".git/config").read_text())
        self.assertEqual({p.name for p in self.staging.iterdir()},
                         {"source.bundle", "package.json", "package-lock.json"})

    def test_bootstrap_preserves_cached_dependencies_and_restores_source(self):
        ci.prepare_source(self.root, self.staging)
        workspace = self.base / "workspace"
        workspace.mkdir()
        (workspace / "node_modules").mkdir()
        cached = workspace / "node_modules/cached.txt"
        cached.write_text("cached")
        for name in ("package.json", "package-lock.json"):
            (workspace / name).write_bytes((self.staging / name).read_bytes())
        bootstrap = ci.BOOTSTRAP.split("node --version")[0].replace(
            "/tmp/source.bundle", str(self.staging / "source.bundle"))
        subprocess.run(["bash", "-c", bootstrap], cwd=workspace, check=True, capture_output=True)
        self.assertEqual(ci.git(workspace, "rev-parse", "HEAD").decode().strip(),
                         self.git("rev-parse", "HEAD").strip())
        self.assertEqual(cached.read_text(), "cached")
        self.assertEqual(ci.git(workspace, "diff", "HEAD"), b"")

    def test_dirty_and_staged_changes_are_rejected(self):
        (self.root / "package.json").write_text("{}")
        for staged in (False, True):
            if staged:
                self.git("add", "package.json")
            with self.assertRaisesRegex(RuntimeError, "Commit tracked changes"):
                ci.prepare_source(self.root, self.staging)

    def test_shallow_checkout_is_rejected(self):
        clone = self.base / "shallow"
        subprocess.run(["git", "clone", "-q", "--depth=1", self.root.as_uri(), str(clone)],
                       check=True, capture_output=True)
        with self.assertRaisesRegex(RuntimeError, "full Git checkout"):
            ci.prepare_source(clone, self.staging)

    def test_linked_worktree_is_supported(self):
        worktree = self.base / "worktree"
        self.git("worktree", "add", "-q", "--detach", str(worktree), "HEAD")
        self.assertTrue((worktree / ".git").is_file())
        self.assertEqual(ci.prepare_source(worktree, self.staging),
                         self.git("rev-parse", "HEAD").strip())


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name) / "evidence"

    def fake_modal(self):
        modal = MagicMock()
        sandbox = modal.Sandbox.create.return_value
        process = sandbox.exec.return_value
        process.stdout = iter(())
        process.stderr = iter(())
        process.returncode = 0
        summary = {"suite": "package", "node": "22.23.4", "pair": "", "exit_code": 0, "source": "a" * 40,
                   "platform": "Linux", "completed": ["package-install", "package-check", "package-pack", "tracked-clean", "whitespace"]}
        payloads = {
            "/tmp/ci-results/manifest.json": json.dumps({"files": ["summary.json", "package-check.log"]}),
            "/tmp/ci-results/summary.json": json.dumps(summary),
            "/tmp/ci-results/package-check.log": "package tests passed\n",
        }
        sandbox.filesystem.read_text.side_effect = payloads.__getitem__
        sandbox.filesystem.read_bytes.side_effect = lambda name: payloads[name].encode("utf-8")
        return modal, sandbox, payloads

    def validate(self, modal, output):
        return ci.run_validation(modal, "image", "package", "22.23.4", "", output,
                                 app=modal.App.return_value, source="a" * 40)

    def test_cell_reuses_app_and_credential_free_sandbox_copies_evidence_then_terminates(self):
        modal, sandbox, _ = self.fake_modal()
        summary = self.validate(modal, self.output)
        self.assertEqual(summary["exit_code"], 0)
        modal.App.assert_not_called()
        modal.App.return_value.run.assert_not_called()
        self.assertEqual((self.output / "package-check.log").read_text(), "package tests passed\n")
        sandbox.terminate.assert_called_once_with()
        kwargs = modal.Sandbox.create.call_args.kwargs
        self.assertEqual(kwargs["secrets"], [])
        self.assertNotIn("env", kwargs)
        self.assertEqual(kwargs["timeout"], 660)
        self.assertEqual(kwargs["workdir"], "/workspace")
        sandbox.exec.return_value.wait.assert_called_once_with()
        self.assertEqual(sandbox.exec.call_args.args[:4], ("bash", "-c", ci.PREPARE_ENV, "dsh-env"))
        self.assertIn("chmod 1777 /tmp", ci.PREPARE_ENV)
        self.assertIn("exec runuser -u dsh-ci", ci.PREPARE_ENV)

    def test_failed_exit_keeps_artifacts_and_still_fails(self):
        modal, sandbox, payloads = self.fake_modal()
        sandbox.exec.return_value.returncode = 1
        payloads["/tmp/ci-results/summary.json"] = json.dumps({"exit_code": 1})
        with self.assertRaisesRegex(RuntimeError, "failed"):
            self.validate(modal, self.output)
        self.assertTrue((self.output / "summary.json").is_file())
        sandbox.terminate.assert_called_once_with()

    def test_exec_wait_collection_and_invalid_summary_fail_and_terminate(self):
        for failure in ("exec", "wait", "collection", "summary", "cell", "source"):
            with self.subTest(failure=failure), TemporaryDirectory() as temporary:
                modal, sandbox, payloads = self.fake_modal()
                if failure == "exec":
                    sandbox.exec.side_effect = RuntimeError("exec failed")
                elif failure == "wait":
                    sandbox.exec.return_value.wait.side_effect = RuntimeError("timeout")
                elif failure == "collection":
                    sandbox.filesystem.read_text.side_effect = RuntimeError("missing evidence")
                elif failure == "source":
                    summary = json.loads(payloads["/tmp/ci-results/summary.json"])
                    summary["source"] = "b" * 40
                    payloads["/tmp/ci-results/summary.json"] = json.dumps(summary)
                else:
                    payloads["/tmp/ci-results/summary.json"] = json.dumps({"exit_code": 1 if failure == "summary" else 0})
                with self.assertRaises(RuntimeError):
                    self.validate(modal, Path(temporary) / "out")
                sandbox.terminate.assert_called_once_with()

    def test_incomplete_success_summary_cannot_claim_validation(self):
        modal, sandbox, payloads = self.fake_modal()
        summary = json.loads(payloads["/tmp/ci-results/summary.json"])
        summary["completed"] = ["package-install"]
        payloads["/tmp/ci-results/summary.json"] = json.dumps(summary)
        with self.assertRaisesRegex(RuntimeError, "required Ubuntu checks"):
            self.validate(modal, self.output)
        sandbox.terminate.assert_called_once_with()

    def test_evidence_rejects_traversal_duplicates_missing_summary_and_oversize(self):
        for names in (["../outside.txt", "summary.json"], ["/tmp/outside.txt", "summary.json"],
                      ["summary.json", "summary.json"], ["package-check.log"], [], [None]):
            with self.subTest(names=names):
                _, sandbox, payloads = self.fake_modal()
                payloads["/tmp/ci-results/manifest.json"] = json.dumps({"files": names})
                with self.assertRaises((ValueError, RuntimeError)):
                    ci.collect_evidence(sandbox, self.output)
                self.assertFalse(self.output.exists())
        _, sandbox, _ = self.fake_modal()
        with patch.object(ci, "MAX_FILE_BYTES", 1), self.assertRaisesRegex(RuntimeError, "limits"):
            ci.collect_evidence(sandbox, self.output)

    def test_image_pins_ubuntu_node_checksum_and_dependency_layers(self):
        modal = MagicMock()
        image = modal.Image.from_registry.return_value
        for method in ("apt_install", "run_commands", "env", "workdir", "add_local_file"):
            getattr(image, method).return_value = image
        staging = Path("/upload")
        self.assertIs(ci.make_image(modal, staging, "24.22.1"), image)
        modal.Image.from_registry.assert_called_once_with("ubuntu:24.04", add_python="3.12")
        commands = [call.args[0] for call in image.run_commands.call_args_list]
        self.assertIn(ci.NODES["24.22.1"], commands[0])
        self.assertIn("sha256sum --check", commands[0])
        self.assertEqual(commands[1], "npm ci --ignore-scripts")
        self.assertIn("useradd --create-home --uid 10001", commands[2])
        self.assertIn("chown -R dsh-ci:dsh-ci /workspace", commands[2])
        self.assertEqual([call[0] for call in image.method_calls][-2:], ["run_commands", "add_local_file"])
        self.assertEqual(image.add_local_file.call_args_list[-1].args,
                         (staging / "source.bundle", "/tmp/source.bundle"))
        self.assertEqual(image.add_local_file.call_args_list[-1].kwargs, {})


class MatrixTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name) / "evidence"
        self.source = "a" * 40

    def fake_modal(self, fail_cell=None, barrier=None):
        modal = MagicMock()
        modal.App.return_value.app_id = "ap-single"
        sandboxes = []
        lock = Lock()
        activity = {"active": 0, "peak": 0}

        def create(*unused, **kwargs):
            sandbox = MagicMock()
            process = sandbox.exec.return_value
            process.stdout = iter(())
            process.stderr = iter(())
            payloads = {}
            with lock:
                sandbox.object_id = f"sb-{len(sandboxes)}"
                sandboxes.append(sandbox)

            def execute(*args, **unused):
                suite = args[args.index("--suite") + 1]
                version = args[args.index("--node-version") + 1]
                pair = args[args.index("--pair") + 1]
                cell = next(c for c in ci.CI_CELLS if (c["suite"], c["node_version"], c["pair"]) == (suite, version, pair))
                process.returncode = int(cell["id"] == fail_cell)
                checks = ["package-install", "package-check", "package-pack", "tracked-clean", "whitespace"]
                summary = {"suite": suite, "node": version, "pair": pair, "exit_code": process.returncode,
                           "source": self.source, "platform": "Linux", "completed": checks}
                if suite == "live":
                    checks.extend(["prepare-upstreams", "ownership-lifecycle", "live-pty"])
                    summary["live"] = {"passed": 32, "failed": 0, "skipped": 0}
                    if pair == "merged-022":
                        checks.extend(["upstream-projection-lifecycle", "upstream-durable-model"])
                payloads.update({
                    f"{ci.REPORTS}/manifest.json": json.dumps({"files": ["summary.json"]}),
                    f"{ci.REPORTS}/summary.json": json.dumps(summary),
                })
                return process

            def wait():
                with lock:
                    activity["active"] += 1
                    activity["peak"] = max(activity["peak"], activity["active"])
                try:
                    if barrier:
                        barrier.wait(timeout=5)
                finally:
                    with lock:
                        activity["active"] -= 1

            sandbox.exec.side_effect = execute
            process.wait.side_effect = wait
            sandbox.filesystem.read_text.side_effect = payloads.__getitem__
            sandbox.filesystem.read_bytes.side_effect = lambda path: payloads[path].encode()
            return sandbox

        modal.Sandbox.create.side_effect = create
        return modal, sandboxes, activity

    def dispatch(self, modal, max_parallel=2):
        with patch.object(ci, "make_image", side_effect=lambda _m, _s, version: f"image-{version}") as images:
            report = ci.run_matrix(modal, Path("/upload"), list(ci.CI_CELLS), self.output,
                                   self.source, max_parallel)
        self.assertEqual(images.call_count, 2)
        return report

    def test_four_sandboxes_share_exactly_one_app_with_bounded_parallelism(self):
        modal, sandboxes, activity = self.fake_modal(barrier=Barrier(2))
        report = self.dispatch(modal)
        self.assertEqual(report["exit_code"], 0)
        self.assertEqual(report["app_id"], "ap-single")
        self.assertEqual(set(report["cells"]), {cell["id"] for cell in ci.CI_CELLS})
        self.assertEqual(activity["peak"], 2)
        modal.App.assert_called_once_with("dsh-session-cleanup-ci")
        modal.App.return_value.run.assert_called_once_with()
        self.assertEqual(modal.Sandbox.create.call_count, 4)
        for call in modal.Sandbox.create.call_args_list:
            self.assertIs(call.kwargs["app"], modal.App.return_value)
            self.assertEqual(call.kwargs["secrets"], [])
        for sandbox in sandboxes:
            sandbox.terminate.assert_called_once_with()
        self.assertEqual(json.loads((self.output / "summary.json").read_text()), report)
        for cell in ci.CI_CELLS:
            self.assertTrue((self.output / cell["id"] / "summary.json").is_file())

    def test_one_failed_cell_retains_evidence_and_all_other_cells_finish_without_retry(self):
        modal, sandboxes, _ = self.fake_modal(fail_cell="package-node22")
        report = self.dispatch(modal)
        self.assertEqual(report["exit_code"], 1)
        self.assertEqual(report["cells"]["package-node22"]["status"], "failure")
        self.assertTrue((self.output / "package-node22/dispatcher-error.json").is_file())
        self.assertEqual(json.loads((self.output / "package-node22/summary.json").read_text())["exit_code"], 1)
        for name, result in report["cells"].items():
            if name != "package-node22":
                self.assertEqual(result["status"], "success")
        modal.App.assert_called_once()
        self.assertEqual(modal.Sandbox.create.call_count, 4)
        for sandbox in sandboxes:
            sandbox.terminate.assert_called_once_with()

    def test_app_start_or_stop_failure_fails_aggregate_without_creating_another_app(self):
        base = self.output
        for phase in ("start", "stop"):
            with self.subTest(phase=phase):
                self.output = base / phase
                modal, sandboxes, _ = self.fake_modal()
                context = modal.App.return_value.run.return_value
                method = context.__enter__ if phase == "start" else context.__exit__
                method.side_effect = RuntimeError(f"app {phase} failed")
                with self.assertRaisesRegex(RuntimeError, f"app {phase} failed"):
                    self.dispatch(modal)
                modal.App.assert_called_once()
                report = json.loads((self.output / "summary.json").read_text())
                self.assertEqual(report["exit_code"], 1)
                self.assertEqual(report["dispatcher_error"], "RuntimeError")
                if phase == "start":
                    modal.Sandbox.create.assert_not_called()
                    self.assertTrue(all(result["status"] == "not_run" for result in report["cells"].values()))
                else:
                    self.assertEqual(modal.Sandbox.create.call_count, 4)
                    self.assertTrue(all(result["status"] == "success" for result in report["cells"].values()))
                    for sandbox in sandboxes:
                        sandbox.terminate.assert_called_once_with()

    def test_invalid_or_duplicate_cells_and_parallelism_fail_before_creating_an_app(self):
        for cells, parallel in (([], 2), (list(ci.CI_CELLS), 0), (list(ci.CI_CELLS), 5),
                                ([ci.CI_CELLS[0], ci.CI_CELLS[0]], 2),
                                ([{**ci.CI_CELLS[0], "id": "../outside"}], 2)):
            with self.subTest(cells=cells, parallel=parallel):
                modal = MagicMock()
                with self.assertRaises(ValueError):
                    ci.run_matrix(modal, Path("/upload"), cells, self.output, self.source, parallel)
                modal.App.assert_not_called()
                self.assertFalse(self.output.exists())


class WorkerTests(unittest.TestCase):
    def test_root_worker_fails_before_any_package_checks_and_keeps_evidence(self):
        with TemporaryDirectory() as temporary:
            artifacts = Path(temporary) / "reports"
            with patch.object(worker.os, "geteuid", return_value=0), patch.object(worker, "package_checks") as checks:
                self.assertEqual(worker.execute("package", "22.23.4", "", artifacts), 1)
            checks.assert_not_called()
            summary = json.loads((artifacts / "summary.json").read_text())
            self.assertEqual(summary["uid"], 0)
            self.assertEqual(summary["exit_code"], 1)
            self.assertIn("non-root", summary["error"])
            self.assertTrue((artifacts / "manifest.json").is_file())

    def test_only_existing_ci_cells_are_allowed(self):
        for args in (("package", "22.23.4", ""), ("package", "24.22.1", ""),
                     ("live", "22.23.4", "validated"), ("live", "24.22.1", "merged-022")):
            validate_cell(*args)
        for args in (("live", "22.23.4", "merged-022"), ("live", "24.22.1", "released-019"),
                     ("package", "26.0.0", ""), ("package", "22.23.4", "validated")):
            with self.assertRaises(ValueError):
                validate_cell(*args)

    def test_worker_environment_drops_credentials_and_inherited_runtime_hooks(self):
        source = {"PATH": "/bin", "HOME": "/home/ci", "CI": "true", "MODAL_TOKEN_SECRET": "private",
                  "CIRCLE_OIDC_TOKEN": "private", "SSH_AUTH_SOCK": "private", "GITHUB_ENV": "private",
                  "NODE_OPTIONS": "--require=private", "BASH_ENV": "private", "DSH_COMPAT_HOME": "/real/user"}
        self.assertEqual(worker.clean_environment(source), {"PATH": "/bin", "HOME": "/home/ci", "CI": "true"})

    def test_circleci_uses_compiled_node_suite_and_always_cleans_after_failure(self):
        runner = MagicMock()
        def run(name, args, *unused):
            if name == "node-tests":
                raise RuntimeError("tests failed")
        runner.run.side_effect = run
        with self.assertRaisesRegex(RuntimeError, "tests failed"):
            worker.package_checks(runner, circleci=True)
        names = [call.args[0] for call in runner.run.call_args_list]
        self.assertEqual(names, ["package-install", "package-build", "test-clean-before", "test-compile", "node-tests", "test-clean-after"])
        runner.run.assert_any_call("node-tests", ["circleci", "testsuite", "run", "node tests"])

    def test_live_tests_keep_both_model_checks_and_full_pty_report(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifacts = root / "artifacts"
            artifacts.mkdir()
            work = root / "work"
            work.mkdir()
            runner = MagicMock()
            runner.artifacts = artifacts
            runner.env = {"PATH": "/bin"}
            def run(name, args, cwd=None):
                if name == "prepare-upstreams":
                    (artifacts / "upstream/prepared.json").write_text(json.dumps({
                        "DSH_COMPAT_NODE": "/node", "DSH_COMPAT_BIN": "/host", "DSH_COMPAT_CWD": "/profile"}))
                if name == "live-pty":
                    (artifacts / "upstream/live-full.json").write_text(json.dumps({"passed": 33, "failed": 0, "skipped": 0}))
            runner.run.side_effect = run
            with patch.object(worker, "checkout_upstream"), patch.object(worker.sys, "platform", "darwin"):
                report = worker.live_checks(runner, "merged-022", work)
            self.assertEqual(report, {"passed": 33, "failed": 0, "skipped": 0})
            names = [call.args[0] for call in runner.run.call_args_list]
            self.assertEqual(names[-4:], ["upstream-projection-lifecycle", "upstream-durable-model", "ownership-lifecycle", "live-pty"])

    def test_manifest_excludes_sources_profiles_and_symlinks(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "summary.json").write_text("{}")
            worker.write_manifest(root)
            self.assertEqual(json.loads((root / "manifest.json").read_text())["files"], ["summary.json"])
            (root / "private.tgz").write_text("not evidence")
            with self.assertRaises(ValueError):
                worker.write_manifest(root)
            (root / "private.tgz").unlink()
            (root / "link.log").symlink_to(root / "summary.json")
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                worker.write_manifest(root)

    def test_evidence_paths_must_be_normalized_relative_text(self):
        for name in ("../escape.log", "/escape.log", "a/../../escape.log", "a//b.log", "./b.log", ".env", "a\\b.log", "source.bundle"):
            with self.assertRaises(ValueError):
                evidence_path(name)
        self.assertEqual(str(evidence_path("upstream/live-full.json")), "upstream/live-full.json")


if __name__ == "__main__":
    unittest.main()
