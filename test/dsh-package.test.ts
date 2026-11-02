import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("package metadata exposes the DSH entry without npm runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.main, "./lib/dsh-entry.js");
  assert.deepEqual(pkg.exports, { ".": "./lib/dsh-entry.js" });
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.optionalDependencies ?? {}, {});
  assert.deepEqual(pkg.peerDependencies ?? {}, {});
});

test("DSH entry loads in an isolated directory without node_modules", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-package-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
    copyFileSync(new URL("../index.js", import.meta.url), join(root, "index.js"));
    cpSync(new URL("../src", import.meta.url), join(root, "src"), { recursive: true });
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      'const entry = await import("./index.js"); console.log(JSON.stringify({ name: entry.name, exports: Object.keys(entry).sort() }));',
    ], { cwd: root, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error ?? ""));
    assert.deepEqual(JSON.parse(result.stdout), {
      name: "dsh-session-cleanup",
      exports: ["apply", "inject", "name"],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
