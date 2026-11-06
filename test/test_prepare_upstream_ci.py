"""Bootstrap contract tests: no network access or upstream builds."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_upstream_ci", ROOT / "scripts/prepare-upstream-ci.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.harness = self.root / "harness"
        self.tui = self.root / "tui"
        self.home = self.root / "home"
        self.log = self.root / "log"
        self.github_env = self.root / "github-env"
        for path, version in ((self.harness / "apps/cli/package.json", "0.2.1-rc.5"),
                              (self.tui / "package.json", "0.18.0")):
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"version": version}))
        self.env = patch.dict(os.environ, {
            "DSH_COMPAT_PAIR": "validated",
            "DSH_COMPAT_HARNESS_ROOT": str(self.harness), "DSH_COMPAT_TUI_ROOT": str(self.tui),
            "DSH_COMPAT_HOME": str(self.home), "DSH_COMPAT_LOG": str(self.log),
            "GITHUB_ENV": str(self.github_env), "TEST_SECRET": "do-not-inherit",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.commands = []
        self.bad_head = False
        self.failed_step = None
        self.plugin_filename = "dsh-session-cleanup-0.2.1.tgz"
        self.tui_filename = "deepseek-harness-tui-dsh-tui-0.18.0.tgz"
        self.produce_plugin_pack = True
        self.produce_tui_pack = True
        self.extra_tui_filename = None
        self.runner = patch.object(prepare.subprocess, "run", side_effect=self.invoke)
        self.runner.start()
        self.addCleanup(self.runner.stop)

    def invoke(self, args, **kwargs):
        if args[0] == "git":
            head = "b830ec950faba0a46dda564be3e2d854afed94f1" if args[2] == str(self.harness) else "1d0d946f459da5149aba64cc6cc0ef7da304053c"
            return subprocess.CompletedProcess(args, 0, stdout="wrong" if self.bad_head else head)
        self.commands.append((args, kwargs["cwd"], kwargs["env"].copy()))
        stdout = None
        if args[1] == "pack":
            packs = Path(args[args.index("--pack-destination") + 1])
            name = self.plugin_filename if args[0] == "npm" else self.tui_filename
            produce = self.produce_plugin_pack if args[0] == "npm" else self.produce_tui_pack
            if produce:
                (packs / name).write_bytes(b"fixture")
            if args[0] == "pnpm":
                kwargs["stdout"].write("prepack stdout is not JSON\n")
                if self.extra_tui_filename:
                    (packs / self.extra_tui_filename).write_bytes(b"extra fixture")
            if args[0] == "npm":
                self.assertIn("--json", args)
                self.assertEqual(kwargs["stdout"], subprocess.PIPE)
                kwargs["stderr"].write("npm warning: fixture diagnostic\n")
                stdout = json.dumps([{"filename": name}])
        return subprocess.CompletedProcess(args, 1 if args[1] == self.failed_step else 0, stdout=stdout)

    def test_bootstrap_builds_pinned_sources_and_exports_real_profile_paths(self):
        prepare.main()
        commands = [args for args, _cwd, _env in self.commands]
        node = shutil.which("node")
        self.assertIn([node, "--import", "tsx/esm", "native/system/scripts/build.ts", "--host-addon-only"], commands)
        self.assertIn([node, "--import", "tsx/esm", "scripts/compile-referenced-projects.ts", "host-libraries"], commands)
        self.assertIn(["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--config.node-linker=hoisted"], commands)
        self.assertTrue(all("TEST_SECRET" not in env for _args, _cwd, env in self.commands))
        install, cwd, env = self.commands[-1]
        self.assertEqual(cwd, self.home / ".dsh/profiles/dsh-tui")
        self.assertEqual(env["HOME"], str(self.home))
        self.assertEqual(env["DSH_HOME"], str(self.home / ".dsh"))
        self.assertIn("plugin", install)
        self.assertIn("add", install)
        self.assertEqual(len([arg for arg in install if arg.startswith("file:")]), 2)
        self.assertNotIn("allow-version", install)
        self.assertIn(f"DSH_COMPAT_CWD={cwd}\n", self.github_env.read_text())
        self.assertTrue((self.log / "prepared.json").is_file())

    def test_plugin_tarball_filename_comes_from_npm_pack_json(self):
        self.plugin_filename = "renamed-plugin-0.3.0-beta.1.tgz"
        prepare.main()
        install, _cwd, _env = self.commands[-1]
        self.assertIn(f"file:{self.home / 'tarballs' / self.plugin_filename}", install)
        pack_log = (self.log / "plugin-pack.log").read_text()
        self.assertIn("npm warning: fixture diagnostic", pack_log)
        self.assertIn(self.plugin_filename, pack_log)

    def test_tui_tarball_filename_comes_from_actual_pack_output(self):
        self.tui_filename = "renamed-tui-0.19.0-rc.1.tgz"
        prepare.main()
        install, _cwd, _env = self.commands[-1]
        self.assertIn(f"file:{self.home / 'tarballs/tui' / self.tui_filename}", install)
        self.assertIn("prepack stdout is not JSON", (self.log / "tui-pack.log").read_text())

    def test_missing_or_ambiguous_tui_tarballs_do_not_install_profile(self):
        for produce, extra in ((False, None), (True, "unexpected.tgz")):
            with self.subTest(produce=produce, extra=extra):
                self.produce_tui_pack = produce
                self.extra_tui_filename = extra
                with self.assertRaisesRegex(SystemExit, "expected exactly one source-built tarball"):
                    prepare.main()
                self.assertFalse((self.home / ".dsh").exists())
                self.assertFalse(self.github_env.exists())
                self.assertFalse((self.log / "prepared.json").exists())
                shutil.rmtree(self.home)

    def test_missing_plugin_tarball_does_not_install_profile_or_export_success(self):
        self.produce_plugin_pack = False
        with self.assertRaisesRegex(SystemExit, "expected source-built tarballs"):
            prepare.main()
        self.assertFalse((self.home / ".dsh").exists())
        self.assertFalse(self.github_env.exists())
        self.assertFalse((self.log / "prepared.json").exists())

    def test_existing_home_is_not_modified(self):
        self.home.mkdir()
        marker = self.home / "keep"
        marker.write_text("untouched")
        with self.assertRaises(SystemExit):
            prepare.main()
        self.assertEqual(marker.read_text(), "untouched")
        self.assertEqual(self.commands, [])

    def test_wrong_checkout_fails_before_install_or_home_creation(self):
        self.bad_head = True
        with self.assertRaises(SystemExit):
            prepare.main()
        self.assertEqual(self.commands, [])
        self.assertFalse(self.home.exists())

    def test_failed_build_does_not_install_profile_or_export_success(self):
        self.failed_step = "install"
        with self.assertRaises(SystemExit):
            prepare.main()
        self.assertEqual(len(self.commands), 1)
        self.assertFalse(self.github_env.exists())
        self.assertFalse((self.log / "prepared.json").exists())


class TarballTests(unittest.TestCase):
    def test_tarball_must_be_a_regular_artifact_inside_the_output_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packs = root / "packs with spaces"
            packs.mkdir()
            outside = root / "outside.tgz"
            outside.write_bytes(b"fixture")
            artifact = packs / "artifact.tgz"
            artifact.symlink_to(outside)
            with self.assertRaisesRegex(SystemExit, "escaped output directory"):
                prepare.find_tarball(packs)
            artifact.unlink()
            artifact.mkdir()
            with self.assertRaisesRegex(SystemExit, "expected exactly one"):
                prepare.find_tarball(packs)
            artifact.rmdir()
            artifact.write_bytes(b"fixture")
            self.assertEqual(prepare.find_tarball(packs), artifact.resolve())


if __name__ == "__main__":
    unittest.main()
