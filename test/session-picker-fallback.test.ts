import assert from "node:assert/strict";
import test from "node:test";

import { selectSessionsForCleanup } from "../src/session-selection.js";
import type { SessionCleanupSession } from "../src/types.js";

function session(path: string): SessionCleanupSession {
  return {
    path,
    id: path,
    cwd: "/work",
    created: new Date("2026-01-01T00:00:00.000Z"),
    modified: new Date("2026-01-01T00:00:00.000Z"),
    messageCount: 0,
    firstMessage: "hello",
    allMessagesText: "hello",
    responsibleAgentName: null,
  };
}

test("selectSessionsForCleanup falls back to the basic selector when the overlay is missing", async () => {
  const notices: Array<{ message: string; type?: string }> = [];
  const result = await selectSessionsForCleanup(
    {
      ui: {
        custom: async () => undefined,
        notify(message: string, type?: string) {
          notices.push({ message, type });
        },
        select: async (_title: string, labels: string[]) =>
          labels.find((label) => label.startsWith("✅")) ?? labels[0],
      },
    } as never,
    [session("/tmp/a.jsonl")],
    "orphaned",
  );

  assert.equal(result.cancelled, false);
  assert.equal(result.refreshRequested, false);
  assert.equal(result.selectedPaths.size, 0);
  assert.equal(notices[0]?.type, "warning");
  assert.match(notices[0]?.message ?? "", /Interactive picker failed/);
});
