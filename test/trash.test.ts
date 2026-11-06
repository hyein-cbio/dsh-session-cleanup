import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { moveToUserTrash, removeSessionArtifact, runTrashProcess, trashPath } from "../src/trash.js";

test("trashPath treats an already-missing path as success", async () => {
  const result = await trashPath("/tmp/does-not-exist-for-trash", {
    existsSync: () => false,
    spawn: async () => {
      throw new Error("spawn should not run");
    },
  });
  assert.deepEqual(result, { ok: true });
});

test("trashPath never unlinks: it moves the target into the user trash", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-trash-"));
  const trashDir = join(root, "Trash");
  const sessionDir = join(root, "session-dir");
  mkdirSync(trashDir);
  mkdirSync(sessionDir);
  writeFileSync(join(sessionDir, "session.v4.jsonl.zstd"), "keep-me");

  const previous = process.env.DSH_SESSION_TRASH_DIR;
  process.env.DSH_SESSION_TRASH_DIR = trashDir;
  try {
    const result = await trashPath(sessionDir, {
      spawn: async () => ({ status: 1, stderr: "no cli trash" }),
    });
    assert.equal(result.ok, true);
    assert.equal(existsSync(sessionDir), false);
    assert.equal(
      readFileSync(join(trashDir, "session-dir", "session.v4.jsonl.zstd"), "utf8"),
      "keep-me",
    );
  } finally {
    if (previous === undefined) delete process.env.DSH_SESSION_TRASH_DIR;
    else process.env.DSH_SESSION_TRASH_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("removeSessionArtifact uses rm -rf off macOS and trash on darwin", async () => {
  const removed: string[] = [];
  const trashed: string[] = [];

  const linux = await removeSessionArtifact("/tmp/session-dir", {
    platform: "linux",
    existsSync: () => true,
    rm: (target) => {
      removed.push(target);
    },
    spawn: async () => {
      throw new Error("trash should not run on linux");
    },
  });
  assert.equal(linux.ok, true);
  assert.deepEqual(removed, ["/tmp/session-dir"]);

  let present = true;
  const mac = await removeSessionArtifact("/tmp/session-dir", {
    platform: "darwin",
    existsSync: (path) => path === "/tmp/session-dir" && present,
    spawn: async () => {
      trashed.push("cli");
      present = false;
      return { status: 0 };
    },
    rm: () => {
      throw new Error("rm should not run on darwin");
    },
  });
  assert.equal(mac.ok, true);
  assert.deepEqual(trashed, ["cli"]);
});

test("moveToUserTrash refuses to invent a trash directory", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-trash-missing-"));
  const previous = process.env.DSH_SESSION_TRASH_DIR;
  process.env.DSH_SESSION_TRASH_DIR = join(root, "does-not-exist");
  try {
    writeFileSync(join(root, "file"), "x");
    assert.equal(moveToUserTrash(join(root, "file")), false);
    assert.equal(existsSync(join(root, "file")), true);
  } finally {
    if (previous === undefined) delete process.env.DSH_SESSION_TRASH_DIR;
    else process.env.DSH_SESSION_TRASH_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});


test("Trash timeout and stderr overflow kill SIGTERM-resistant providers", { timeout: 8_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-trash-process-"));
  const previous = process.env.PATH;
  const executable = join(root, "trash");
  writeFileSync(executable, `#!${process.execPath}
process.on('SIGTERM', () => {});
if (process.argv[2] === 'flood') process.stderr.write('x'.repeat(2048));
setInterval(() => {}, 100);
`, { mode: 0o700 });
  process.env.PATH = root;
  try {
    for (const mode of ["timeout", "flood"]) {
      const result = await runTrashProcess("trash", [mode], { timeout: 500, maxStderrBytes: 1024 });
      assert.match(result.error?.message ?? "", mode === "flood" ? /stderr exceeded/ : /timed out/);
      assert.equal(result.unsafeToRetry, undefined, "provider group must actually terminate");
    }
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("unconfirmed provider termination never starts another provider or fallback", async () => {
  let calls = 0;
  const result = await trashPath("/session", {
    existsSync: () => true,
    spawn: async () => { calls++; return { status: null, unsafeToRetry: true }; },
    moveToUserTrash: () => { assert.fail("must not race an unconfirmed provider"); },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});

test("provider exit zero without removing the target is not success", async () => {
  const result = await trashPath("/session", {
    existsSync: () => true,
    spawn: async () => ({ status: 0 }),
    moveToUserTrash: () => false,
  });
  assert.equal(result.ok, false);
});


test("access failures return failed removal results without invoking providers", async () => {
  for (const platform of ["darwin", "linux"] as const) {
    const result = await removeSessionArtifact("/session", {
      platform,
      existsSync() { throw new Error("EACCES: inaccessible parent"); },
      spawn: async () => { assert.fail("must not spawn on an access error"); },
      rm: () => assert.fail("must not remove on an access error"),
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /EACCES/);
  }
});
