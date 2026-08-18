import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleDshSessionCleanupCommand } from "../src/dsh/command.js";
import { dshCleanupUsage } from "../src/dsh/parse.js";

const orphanId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function persistenceHost(options: {
  cwd: string;
  ask?: (request: { questions: Array<{ id: string; options?: Array<{ label: string }> }> }) =>
    Promise<{ answers: Array<{ id: string; selected: string[] }> }>;
  sessionDir?: string;
  liveAgentId?: string;
}) {
  return {
    get(name: string): unknown {
      if (name === "sessionPersistence") {
        return {
          listSnapshots: async () => [
            { header: { id: orphanId, createdAt: Date.now(), cwd: join(options.cwd, "missing") } },
            { header: { id: otherId, createdAt: Date.now() - 1000, cwd: options.cwd } },
          ],
          locate: (header: { id: string }) => ({
            kind: "jsonl",
            path: join(options.sessionDir ?? "/tmp", `session-${header.id}`, "session.jsonl.zstd"),
          }),
        };
      }
      if (name === "userQuestions" && options.ask) {
        return { ask: options.ask };
      }
      if (name === "workspaceRegistry") {
        return { archivedSessionIds: [] };
      }
      if (name === "agents") {
        return {
          get: (id: string) => (options.liveAgentId && id.includes(options.liveAgentId) ? {} : undefined),
        };
      }
      return undefined;
    },
  };
}

test("DSH command help and unknown arguments", async () => {
  const help = await handleDshSessionCleanupCommand({ get: () => undefined }, { rawInput: "help" });
  assert.equal(help.kind, "success");
  assert.equal(help.text, dshCleanupUsage());

  const unknown = await handleDshSessionCleanupCommand({ get: () => undefined }, { rawInput: "nope" });
  assert.equal(unknown.kind, "error");
  assert.match(unknown.text ?? "", /Unknown argument: nope/);
});

test("DSH command reports empty orphaned and current scopes", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "dsh-cmd-empty-"));
  try {
    const orphaned = await handleDshSessionCleanupCommand(
      persistenceHost({ cwd }),
      { rawInput: "orphaned", agent: { session: { id: orphanId, header: { cwd } } } },
    );
    assert.equal(orphaned.kind, "success");
    assert.match(orphaned.text ?? "", /No orphaned sessions found/);

    const current = await handleDshSessionCleanupCommand(
      {
        get(name: string) {
          if (name === "sessionPersistence") {
            return {
              listSnapshots: async () => [],
              locate: () => undefined,
            };
          }
          return undefined;
        },
      },
      { rawInput: "current", agent: { options: { cwd } } },
    );
    assert.equal(current.kind, "success");
    assert.match(current.text ?? "", /No deletable sessions found/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("DSH command cancels when the user selects nothing or declines confirm", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "dsh-cmd-cancel-"));
  try {
    const cancelledPick = await handleDshSessionCleanupCommand(
      persistenceHost({
        cwd,
        ask: async () => ({ answers: [{ id: "sessions", selected: [] }] }),
      }),
      { rawInput: "all", agent: { session: { header: { cwd } } } },
    );
    assert.deepEqual(cancelledPick, { kind: "success", text: "Session cleanup cancelled." });

    const cancelledConfirm = await handleDshSessionCleanupCommand(
      persistenceHost({
        cwd,
        ask: async (request) => {
          if (request.questions[0]?.id === "sessions") {
            return {
              answers: [{ id: "sessions", selected: [request.questions[0]!.options![0]!.label] }],
            };
          }
          return { answers: [{ id: "confirm", selected: ["Cancel"] }] };
        },
      }),
      { rawInput: "all", agent: { session: { header: { cwd } } } },
    );
    assert.deepEqual(cancelledConfirm, { kind: "success", text: "Delete cancelled." });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("DSH command delete reports missing ids and persistence failures", async () => {
  const missing = await handleDshSessionCleanupCommand(
    persistenceHost({ cwd: "/work" }),
    { rawInput: "delete ffffffff-ffff-4fff-8fff-ffffffffffff" },
  );
  assert.equal(missing.kind, "error");
  assert.match(missing.text ?? "", /No matching sessions/);

  const failed = await handleDshSessionCleanupCommand(
    { get: () => undefined },
    { rawInput: "all" },
  );
  assert.equal(failed.kind, "error");
  assert.match(failed.text ?? "", /sessionPersistence is not mounted/);
});

test("DSH command pick+confirm deletes the chosen session", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "dsh-cmd-pick-"));
  const root = mkdtempSync(join(tmpdir(), "dsh-cmd-pick-home-"));
  const previousHome = process.env.DSH_HOME;
  const previousTrash = process.env.DSH_SESSION_TRASH_DIR;
  const trashRoot = join(root, "trash");
  const sessionDir = join(root, "sessions", "--work--", `session-${orphanId}`);
  mkdirSync(trashRoot, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "session.jsonl.zstd"), "x");
  process.env.DSH_HOME = root;
  process.env.DSH_SESSION_TRASH_DIR = trashRoot;

  try {
    const outcome = await handleDshSessionCleanupCommand(
      persistenceHost({
        cwd,
        sessionDir: join(root, "sessions", "--work--"),
        ask: async (request) => {
          if (request.questions[0]?.id === "sessions") {
            const label = request.questions[0]!.options!.find((option) => option.label.includes(orphanId.slice(0, 8)));
            assert.ok(label);
            return { answers: [{ id: "sessions", selected: [label.label] }] };
          }
          return { answers: [{ id: "confirm", selected: ["Delete"] }] };
        },
      }),
      { rawInput: "orphaned", agent: { session: { id: "live", header: { cwd } } } },
    );
    assert.equal(outcome.kind, "success");
    assert.match(outcome.text ?? "", /Deleted 1 session/);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousTrash === undefined) delete process.env.DSH_SESSION_TRASH_DIR;
    else process.env.DSH_SESSION_TRASH_DIR = previousTrash;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
