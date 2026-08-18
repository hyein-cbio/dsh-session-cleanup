import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleDshSessionCleanupCommand } from "../src/dsh/command.js";

const existing = mkdtempSync(join(tmpdir(), "dsh-cleanup-cmd-"));
const orphanId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function createListHost() {
  return {
    get(name: string): unknown {
      if (name === "sessionPersistence") {
        return {
          listSnapshots: async () => [
            { header: { id: orphanId, createdAt: Date.now(), cwd: join(existing, "missing") } },
          ],
          locate: () => ({
            kind: "jsonl",
            path: join("/tmp", "session.jsonl.zstd"),
          }),
        };
      }
      if (name === "workspaceRegistry") {
        return { archivedSessionIds: [] };
      }
      if (name === "agents") {
        return { get: () => undefined };
      }
      return undefined;
    },
  };
}

test("DSH command lists ids when no questions service is mounted", async () => {
  const outcome = await handleDshSessionCleanupCommand(createListHost(), {
    rawInput: "",
    agent: { session: { id: "live", header: { cwd: existing } } },
  });
  assert.equal(outcome.kind, "success");
  assert.match(outcome.text ?? "", /session-cleanup delete/);
  assert.match(outcome.text ?? "", new RegExp(orphanId.slice(0, 8), "u"));
});

test("DSH command delete <id> removes a located session after confirm", async () => {
  const previousHome = process.env.DSH_HOME;
  const previousTrash = process.env.DSH_SESSION_TRASH_DIR;
  const root = mkdtempSync(join(tmpdir(), "dsh-cleanup-cmd-del-"));
  const trashRoot = join(root, "trash");
  mkdirSync(trashRoot, { recursive: true });
  process.env.DSH_HOME = root;
  process.env.DSH_SESSION_TRASH_DIR = trashRoot;
  const sessionDir = join(root, "sessions", "--work--", `session-${orphanId}`);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "session.jsonl.zstd"), "x");

  const ctx = {
    get(name: string): unknown {
      if (name === "sessionPersistence") {
        return {
          listSnapshots: async () => [
            { header: { id: `session-${orphanId}`, createdAt: Date.now(), cwd: join(existing, "missing") } },
          ],
          locate: () => ({
            kind: "jsonl",
            path: join(sessionDir, "session.jsonl.zstd"),
          }),
        };
      }
      if (name === "userQuestions") {
        return {
          ask: async () => ({ answers: [{ id: "confirm", selected: ["Delete"] }] }),
        };
      }
      if (name === "workspaceRegistry") {
        return { archivedSessionIds: [] };
      }
      if (name === "agents") {
        return { get: () => undefined };
      }
      return undefined;
    },
  };

  try {
    const outcome = await handleDshSessionCleanupCommand(ctx, {
      rawInput: `delete ${orphanId}`,
      agent: { session: { id: "live", header: { cwd: existing } } },
    });
    assert.equal(outcome.kind, "success");
    assert.match(outcome.text ?? "", /Deleted 1 session/);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousTrash === undefined) delete process.env.DSH_SESSION_TRASH_DIR;
    else process.env.DSH_SESSION_TRASH_DIR = previousTrash;
    rmSync(root, { recursive: true, force: true });
    rmSync(existing, { recursive: true, force: true });
  }
});
