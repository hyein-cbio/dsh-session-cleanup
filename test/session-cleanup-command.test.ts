import assert from "node:assert/strict";
import test from "node:test";

import { getMatchedCompletions, SESSION_CLEANUP_ARGUMENT_COMPLETIONS } from "../src/argument-completions.js";
import { parseSessionCleanupArgs } from "../src/session-cleanup-command.js";

test("parseSessionCleanupArgs defaults to the orphaned scope", () => {
  assert.deepEqual(parseSessionCleanupArgs(""), { help: false, scope: "orphaned" });
  assert.deepEqual(parseSessionCleanupArgs("   "), { help: false, scope: "orphaned" });
  assert.deepEqual(parseSessionCleanupArgs("orphaned"), { help: false, scope: "orphaned" });
});

test("parseSessionCleanupArgs accepts current, all, and help", () => {
  assert.deepEqual(parseSessionCleanupArgs("current"), { help: false, scope: "current" });
  assert.deepEqual(parseSessionCleanupArgs("ALL"), { help: false, scope: "all" });
  assert.deepEqual(parseSessionCleanupArgs("help"), { help: true, scope: "orphaned" });
});

test("parseSessionCleanupArgs rejects unknown arguments", () => {
  assert.deepEqual(parseSessionCleanupArgs("stale"), {
    help: false,
    scope: "orphaned",
    error: "Unknown argument: stale",
  });
});

test("parseSessionCleanupArgs usage stays limited to Pi scopes", () => {
  assert.deepEqual(parseSessionCleanupArgs("orphaned"), { help: false, scope: "orphaned" });
  assert.equal(parseSessionCleanupArgs("delete x").error, "Unknown argument: delete x");
});

test("session-cleanup completions include the orphaned scope", () => {
  const completions = getMatchedCompletions("", SESSION_CLEANUP_ARGUMENT_COMPLETIONS);
  assert.ok(completions?.some((completion) => completion.value === "orphaned"));
  assert.deepEqual(
    getMatchedCompletions("orp", SESSION_CLEANUP_ARGUMENT_COMPLETIONS)?.map((completion) => completion.value),
    ["orphaned"],
  );
});
