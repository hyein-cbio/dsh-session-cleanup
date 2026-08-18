import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listDshSessions } from "../src/dsh/list-sessions.js";

const existing = mkdtempSync(join(tmpdir(), "dsh-cleanup-cwd-"));

test("listDshSessions uses locate() and filters orphaned/current/active/archived", async () => {
  const liveId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const orphanId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const currentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const archivedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  const headers = [
    { id: liveId, createdAt: 4, cwd: existing },
    { id: orphanId, createdAt: 3, cwd: join(existing, "gone") },
    { id: currentId, createdAt: 2, cwd: existing },
    { id: archivedId, createdAt: 1, cwd: join(existing, "also-gone") },
  ];

  const ctx = {
    get(name: string): unknown {
      if (name === "sessionPersistence") {
        return {
          listSnapshots: async () => headers.map((header) => ({ header })),
          locate: (header: { id: string }) => ({
            kind: "jsonl",
            path: join("/tmp/dsh-sessions", `session-${header.id}`, "session.jsonl.zstd"),
          }),
        };
      }
      if (name === "workspaceRegistry") {
        return { archivedSessionIds: [archivedId] };
      }
      if (name === "agents") {
        return { get: () => undefined };
      }
      return undefined;
    },
  };

  try {
    const orphaned = await listDshSessions(ctx, {
      scope: "orphaned",
      currentSessionId: liveId,
    });
    assert.deepEqual(orphaned.map((session) => session.id), [orphanId]);
    assert.equal(orphaned[0]?.path.endsWith("session.jsonl.zstd"), true);

    const current = await listDshSessions(ctx, {
      scope: "current",
      currentCwd: existing,
      currentSessionId: liveId,
    });
    assert.deepEqual(current.map((session) => session.id), [currentId]);

    const all = await listDshSessions(ctx, {
      scope: "all",
      currentSessionId: liveId,
      includeArchived: true,
    });
    assert.deepEqual(all.map((session) => session.id), [orphanId, currentId, archivedId]);
  } finally {
    rmSync(existing, { recursive: true, force: true });
  }
});

test("listDshSessions throws without persistence and skips unlocated rows", async () => {
  await assert.rejects(
    () => listDshSessions({ get: () => undefined }, { scope: "all" }),
    /sessionPersistence is not mounted/,
  );

  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const listed = await listDshSessions(
    {
      get(name: string) {
        if (name === "sessionPersistence") {
          return {
            listSnapshots: async () => [
              { header: { id, createdAt: 2 } },
              { header: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", createdAt: 1, cwd: "/gone" } },
            ],
            locate: (header: { id: string }) =>
              header.id === id ? undefined : { kind: "jsonl", path: `/tmp/${header.id}/session.jsonl.zstd` },
          };
        }
        if (name === "agents") {
          return { get: (agentId: string) => (agentId.includes("bbbb") ? {} : undefined) };
        }
        return undefined;
      },
    },
    { scope: "all" },
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(listed[0]?.running, true);
  assert.equal(listed[0]?.title, "/gone");
});

test("listDshSessions current scope with no cwd yields an empty list", async () => {
  const listed = await listDshSessions(
    {
      get(name: string) {
        if (name === "sessionPersistence") {
          return {
            listSnapshots: async () => [
              { header: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", createdAt: 1, cwd: "/work" } },
            ],
            locate: () => ({ kind: "jsonl", path: "/tmp/x/session.jsonl.zstd" }),
          };
        }
        return undefined;
      },
    },
    { scope: "current" },
  );
  assert.deepEqual(listed, []);
});
