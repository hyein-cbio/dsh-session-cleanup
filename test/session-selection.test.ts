import assert from "node:assert/strict";
import test from "node:test";

import { selectSessionsForCleanup } from "../src/session-selection.js";
import type { SessionCleanupSession, SessionScope } from "../src/types.js";

function session(path: string, firstMessage = "hello"): SessionCleanupSession {
  return {
    path,
    id: path,
    cwd: "/work",
    created: new Date("2026-01-01T00:00:00.000Z"),
    modified: new Date("2026-01-01T00:00:00.000Z"),
    messageCount: 0,
    firstMessage,
    allMessagesText: firstMessage,
    responsibleAgentName: null,
  };
}

function createSelector(
  choices: Array<(labels: string[]) => string | undefined>,
): {
  titles: string[];
  notices: Array<{ message: string; type?: string }>;
  ctx: {
    ui: {
      notify(message: string, type?: string): void;
      select(title: string, labels: string[]): Promise<string | undefined>;
    };
  };
} {
  const titles: string[] = [];
  const notices: Array<{ message: string; type?: string }> = [];
  let call = 0;

  return {
    titles,
    notices,
    ctx: {
      ui: {
        notify(message: string, type?: string) {
          notices.push({ message, type });
        },
        select: async (title: string, labels: string[]) => {
          titles.push(title);
          const choice = choices[call];
          call += 1;
          return choice ? choice(labels) : undefined;
        },
      },
    },
  };
}

async function select(
  sessions: readonly SessionCleanupSession[],
  scope: SessionScope,
  choices: Array<(labels: string[]) => string | undefined>,
) {
  const harness = createSelector(choices);
  const result = await selectSessionsForCleanup(harness.ctx as never, sessions, scope);
  return { ...harness, result };
}

function labelIncluding(fragment: string) {
  return (labels: string[]) => labels.find((label) => label.includes(fragment));
}

test("selectSessionsForCleanup confirms through the basic selector", async () => {
  const { result, notices, titles } = await select(
    [session("/tmp/a.jsonl")],
    "orphaned",
    [labelIncluding("✅")],
  );

  assert.equal(result.cancelled, false);
  assert.equal(result.refreshRequested, false);
  assert.equal(result.selectedPaths.size, 0);
  assert.deepEqual(notices, []);
  assert.equal(titles[0], "Select orphaned sessions to delete (toggle multiple, then confirm)");
});

test("selectSessionsForCleanup toggles a session and then confirms", async () => {
  const { result } = await select(
    [session("/tmp/a.jsonl"), session("/tmp/b.jsonl", "other")],
    "all",
    [labelIncluding("hello"), labelIncluding("✅")],
  );

  assert.equal(result.cancelled, false);
  assert.equal(result.refreshRequested, false);
  assert.deepEqual([...result.selectedPaths], ["/tmp/a.jsonl"]);
});

test("selectSessionsForCleanup selects every session and can clear them", async () => {
  const selected = await select(
    [session("/tmp/a.jsonl"), session("/tmp/b.jsonl", "other")],
    "current",
    [labelIncluding("Select all"), labelIncluding("✅")],
  );
  assert.equal(selected.titles[0], "Select current-directory sessions to delete (toggle multiple, then confirm)");
  assert.deepEqual(
    [...selected.result.selectedPaths].sort(),
    ["/tmp/a.jsonl", "/tmp/b.jsonl"],
  );

  const cleared = await select(
    [session("/tmp/a.jsonl"), session("/tmp/b.jsonl", "other")],
    "current",
    [labelIncluding("Select all"), labelIncluding("Clear all"), labelIncluding("✅")],
  );
  assert.equal(cleared.result.selectedPaths.size, 0);
  assert.equal(cleared.result.cancelled, false);
});

test("selectSessionsForCleanup treats a dismissed menu as cancel", async () => {
  const { result } = await select([session("/tmp/a.jsonl")], "orphaned", [
    () => undefined,
  ]);

  assert.equal(result.cancelled, true);
  assert.equal(result.refreshRequested, false);
  assert.equal(result.selectedPaths.size, 0);
});

test("selectSessionsForCleanup returns when refresh or cancel is chosen", async () => {
  const refreshed = await select([session("/tmp/a.jsonl")], "orphaned", [
    labelIncluding("Refresh"),
  ]);
  assert.equal(refreshed.result.refreshRequested, true);
  assert.equal(refreshed.result.cancelled, false);

  const cancelled = await select([session("/tmp/a.jsonl")], "orphaned", [
    labelIncluding("Cancel"),
  ]);
  assert.equal(cancelled.result.cancelled, true);
  assert.equal(cancelled.result.refreshRequested, false);
});

test("selectSessionsForCleanup warns on an unknown action and keeps the menu open", async () => {
  const { result, notices } = await select([session("/tmp/a.jsonl")], "orphaned", [
    () => "not-a-real-label",
    labelIncluding("Cancel"),
  ]);

  assert.equal(notices[0]?.type, "warning");
  assert.match(notices[0]?.message ?? "", /Unknown selection action/);
  assert.equal(result.cancelled, true);
});
