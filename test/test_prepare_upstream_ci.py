"""Bootstrap contract tests: no network access or upstream builds."""

import importlib.util
import json
import os
from pathlib import Path
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
            "DSH_COMPAT_HARNESS_ROOT": str(self.harness), "DSH_COMPAT_TUI_ROOT": str(self.tui),
            "DSH_COMPAT_HOME": str(self.home), "DSH_COMPAT_LOG": str(self.log),
            "GITHUB_ENV": str(self.github_env), "TEST_SECRET": "do-not-inherit",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.commands = []
        self.bad_head = False
        self.failed_step = None
        self.runner = patch.object(prepare.subprocess, "run", side_effect=self.invoke)
        self.runner.start()
        self.addCleanup(self.runner.stop)

    def invoke(self, args, **kwargs):
        if args[0] == "git":
            head = "b830ec950faba0a46dda564be3e2d854afed94f1" if args[2] == str(self.harness) else "1d0d946f459da5149aba64cc6cc0ef7da304053c"
            return subprocess.CompletedProcess(args, 0, stdout="wrong" if self.bad_head else head)
        self.commands.append((args, kwargs["cwd"], kwargs["env"].copy()))
        if args[1] == "pack":
            packs = Path(args[args.index("--pack-destination") + 1])
            name = "dsh-session-cleanup-0.2.1.tgz" if args[0] == "npm" else "deepseek-harness-tui-dsh-tui-0.18.0.tgz"
            (packs / name).write_bytes(b"fixture")
        return subprocess.CompletedProcess(args, 1 if args[1] == self.failed_step else 0)

    def test_bootstrap_builds_pinned_sources_and_exports_real_profile_paths(self):
        prepare.main()
        commands = [args for args, _cwd, _env in self.commands]
        self.assertIn(["pnpm", "run", "build:native-system"], commands)
        self.assertIn(["pnpm", "exec", "tsx", "scripts/compile-referenced-projects.ts", "host-libraries"], commands)
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


if __name__ == "__main__":
    unittest.main()
