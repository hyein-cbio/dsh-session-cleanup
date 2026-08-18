import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isOrphanedSession } from "../src/session-source.js";

test("isOrphanedSession treats missing or blank cwd as orphaned", () => {
  assert.equal(isOrphanedSession({}), true);
  assert.equal(isOrphanedSession({ cwd: null }), true);
  assert.equal(isOrphanedSession({ cwd: "" }), true);
  assert.equal(isOrphanedSession({ cwd: "   " }), true);
});

test("isOrphanedSession treats a missing or non-directory cwd as orphaned", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "session-cleanup-orphaned-"));
  const missingDir = join(tempDir, "gone");
  const filePath = join(tempDir, "not-a-dir");
  writeFileSync(filePath, "session", "utf8");

  try {
    assert.equal(isOrphanedSession({ cwd: tempDir }), false);
    assert.equal(isOrphanedSession({ cwd: missingDir }), true);
    assert.equal(isOrphanedSession({ cwd: filePath }), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
