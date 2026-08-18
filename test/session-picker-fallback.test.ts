import assert from "node:assert/strict";
import test from "node:test";

import { selectSessionsForCleanup } from "../src/session-selection.js";
import { showSessionCleanupPicker } from "../src/tui/session-cleanup-picker.js";
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

test("showSessionCleanupPicker fails closed when custom() is a no-op", async () => {
  await assert.rejects(
    () =>
      showSessionCleanupPicker(
        {
          ui: {
            custom: async () => undefined,
          },
        } as never,
        [session("/tmp/a.jsonl")],
        "all",
      ),
    /Interactive picker is unavailable/,
  );
});

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
