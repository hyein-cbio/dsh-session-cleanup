import assert from "node:assert/strict";
import test from "node:test";

import { parseDshSessionCleanupArgs } from "../src/dsh/parse.js";
import { idsMatch, isSessionId, sessionIdVariants } from "../src/dsh/ids.js";

test("parseDshSessionCleanupArgs defaults to orphaned listing", () => {
  assert.deepEqual(parseDshSessionCleanupArgs(""), { kind: "list", scope: "orphaned" });
  assert.deepEqual(parseDshSessionCleanupArgs("current"), { kind: "list", scope: "current" });
  assert.deepEqual(parseDshSessionCleanupArgs("help"), { kind: "help" });
});

test("parseDshSessionCleanupArgs accepts explicit delete ids", () => {
  assert.deepEqual(parseDshSessionCleanupArgs("delete abc session-1"), {
    kind: "delete",
    ids: ["abc", "session-1"],
  });
  assert.equal(parseDshSessionCleanupArgs("delete").kind, "error");
});

test("parseDshSessionCleanupArgs rejects extra scope tokens and unknown heads", () => {
  assert.deepEqual(parseDshSessionCleanupArgs("all extra"), {
    kind: "error",
    error: "Unexpected extra arguments: extra",
  });
  assert.deepEqual(parseDshSessionCleanupArgs("stale"), {
    kind: "error",
    error: "Unknown argument: stale",
  });
  assert.deepEqual(parseDshSessionCleanupArgs("  ALL  "), { kind: "list", scope: "all" });
});

test("sessionIdVariants covers raw uuid and session- prefix", () => {
  const id = "2285c24b-3ecf-45f7-b9ce-3d39fb78955e";
  assert.deepEqual(sessionIdVariants(id).sort(), [id, `session-${id}`].sort());
  assert.deepEqual(sessionIdVariants(`session-${id}`).sort(), [id, `session-${id}`].sort());
  assert.equal(isSessionId(id), true);
  assert.equal(isSessionId(`session-${id}`), true);
  assert.equal(idsMatch(id, `session-${id}`), true);
  assert.equal(isSessionId("not-a-session"), false);
  assert.equal(isSessionId(`  ${id}  `), true);
  assert.equal(idsMatch(id, "ffffffff-ffff-4fff-8fff-ffffffffffff"), false);
  assert.deepEqual(sessionIdVariants("custom-name"), ["custom-name"]);
});
