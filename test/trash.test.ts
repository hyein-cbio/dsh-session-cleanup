import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { moveToUserTrash, removeSessionArtifact, trashPath } from "../src/trash.js";

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
  writeFileSync(join(sessionDir, "session.jsonl.zstd"), "keep-me");

  const previous = process.env.DSH_SESSION_TRASH_DIR;
  process.env.DSH_SESSION_TRASH_DIR = trashDir;
  try {
    const result = await trashPath(sessionDir, {
      spawn: async () => ({ status: 1, stderr: "no cli trash" }),
    });
    assert.equal(result.ok, true);
    assert.equal(existsSync(sessionDir), false);
    assert.equal(
      readFileSync(join(trashDir, "session-dir", "session.jsonl.zstd"), "utf8"),
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

  const mac = await removeSessionArtifact("/tmp/session-dir", {
    platform: "darwin",
    existsSync: (path) => path === "/tmp/session-dir",
    spawn: async () => {
      trashed.push("cli");
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
