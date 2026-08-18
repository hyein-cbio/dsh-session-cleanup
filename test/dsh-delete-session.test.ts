import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { deleteDshSession, DshDeleteError } from "../src/dsh/delete-session.js";

const sessionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

test("deleteDshSession rejects invalid ids", async () => {
  await assert.rejects(
    () => deleteDshSession({ get: () => undefined }, "nope"),
    (error: unknown) => error instanceof DshDeleteError && error.status === 400,
  );
});

test("deleteDshSession removes locate() dir, cache, workspace, and sidecar", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-cleanup-del-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;

  const sessionDir = join(root, "sessions", "--work--", `session-${sessionId}`);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "session.jsonl.zstd"), "not-parsed");

  const sidecar = join(root, "pi2dsh", "agent", "session-entries", `${sessionId}.jsonl`);
  mkdirSync(join(sidecar, ".."), { recursive: true });
  writeFileSync(sidecar, "{}\n");

  const proj = new Map<string, unknown>([[sessionId, { rows: {} }]]);
  const workspaceRec = {
    sessionIds: [sessionId, "keep-me"],
  };
  const workspaces = new Map<string, unknown>([["ws-1", workspaceRec]]);
  let archived = [sessionId];
  let cancelled = false;
  let flushed = false;
  let detached = false;

  const ctx = {
    get(name: string): unknown {
      if (name === "sessionPersistence") {
        return {
          listSnapshots: async () => [
            { header: { id: `session-${sessionId}`, createdAt: 1, cwd: "/work" } },
          ],
          locate: () => ({
            kind: "jsonl",
            path: join(sessionDir, "session.jsonl.zstd"),
          }),
        };
      }
      if (name === "agents") {
        return {
          get: (id: string) =>
            id.includes(sessionId)
              ? {
                  cancel: () => {
                    cancelled = true;
                  },
                  whenIdle: async () => undefined,
                }
              : undefined,
        };
      }
      if (name === "sessions") {
        const session = { header: { id: `session-${sessionId}`, cwd: "/work" } };
        return {
          get: (id: string) => (id.includes(sessionId) ? session : undefined),
          flush: async () => {
            flushed = true;
          },
          store: {
            get: (id: string) => (id.includes(sessionId) ? { session } : undefined),
          },
          detachEntered: () => {
            detached = true;
          },
        };
      }
      if (name === "storageDomain") {
        return {
          get: (domain: string) => {
            if (domain === "session_projcache") {
              return {
                table: () => ({
                  get: (id: string) => proj.get(id),
                  delete: async (id: string) => {
                    proj.delete(id);
                  },
                  entries: () => proj.entries(),
                }),
              };
            }
            if (domain === "workspace") {
              return {
                table: () => ({
                  get: (id: string) => workspaces.get(id),
                  delete: async () => undefined,
                  put: async (id: string, value: unknown) => {
                    workspaces.set(id, value);
                  },
                  entries: () => workspaces.entries(),
                }),
                global: {
                  get: () => ({ archivedSessionIds: archived }),
                  set: async (value: { archivedSessionIds: string[] }) => {
                    archived = value.archivedSessionIds;
                  },
                },
              };
            }
            return undefined;
          },
        };
      }
      return undefined;
    },
  };

  try {
    const trashRoot = join(root, "trash");
    mkdirSync(trashRoot, { recursive: true });
    const outcome = await deleteDshSession(ctx, sessionId, {
      removePath: async (target) => {
        renameSync(target, join(trashRoot, basename(target)));
        return { ok: !existsSync(target) };
      },
    });
    assert.equal(outcome.stopped, true);
    assert.equal(outcome.flushed, true);
    assert.equal(outcome.detached, true);
    assert.equal(outcome.dirRemoved, true);
    assert.equal(outcome.projRemoved, true);
    assert.equal(outcome.workspaceRemoved, true);
    assert.equal(outcome.sidecarRemoved, true);
    assert.equal(cancelled, true);
    assert.equal(flushed, true);
    assert.equal(detached, true);
    assert.equal(proj.has(sessionId), false);
    assert.deepEqual((workspaces.get("ws-1") as { sessionIds: string[] }).sessionIds, ["keep-me"]);
    assert.deepEqual(archived, []);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleteDshSession is 404 when nothing exists to clean", async () => {
  await assert.rejects(
    () => deleteDshSession({ get: () => undefined }, sessionId),
    (error: unknown) => error instanceof DshDeleteError && error.status === 404,
  );
});

test("deleteDshSession is 500 when trash leaves the session directory", async () => {
  const sessionDir = "/tmp/dsh-still-there";
  await assert.rejects(
    () =>
      deleteDshSession(
        {
          get(name: string) {
            if (name === "sessionPersistence") {
              return {
                listSnapshots: async () => [{ header: { id: sessionId, cwd: "/work" } }],
                locate: () => ({ kind: "jsonl", path: `${sessionDir}/session.jsonl.zstd` }),
              };
            }
            return undefined;
          },
        },
        sessionId,
        {
          existsDir: () => true,
          removePath: async () => ({ ok: false, error: "trash full" }),
        },
      ),
    (error: unknown) =>
      error instanceof DshDeleteError
      && error.status === 500
      && error.message.includes("could not be removed")
      && error.message.includes("trash full"),
  );
});

test("deleteDshSession continues when cancel/flush throw and detaches via store.delete", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-cleanup-detach-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const sessionDir = join(root, "sessions", "--work--", sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "session.jsonl.zstd"), "x");
  let storeDeleted = false;

  try {
    const outcome = await deleteDshSession(
      {
        get(name: string) {
          if (name === "agents") {
            return {
              get: () => ({
                cancel: () => {
                  throw new Error("already settling");
                },
                whenIdle: async () => {
                  throw new Error("idle failed");
                },
              }),
            };
          }
          if (name === "sessions") {
            const session = { header: { id: sessionId, cwd: "/work" } };
            return {
              get: () => session,
              flush: async () => {
                throw new Error("flush failed");
              },
              store: {
                get: () => ({ session }),
                delete: () => {
                  storeDeleted = true;
                },
              },
            };
          }
          if (name === "sessionPersistence") {
            return {
              listSnapshots: async () => {
                throw new Error("snapshots unavailable");
              },
              locate: () => undefined,
            };
          }
          return undefined;
        },
      },
      sessionId,
      {
        removePath: async (target) => {
          rmSync(target, { recursive: true, force: true });
          return { ok: true };
        },
      },
    );
    assert.equal(outcome.stopped, true);
    assert.equal(outcome.flushed, false);
    assert.equal(outcome.detached, true);
    assert.equal(outcome.dirRemoved, true);
    assert.equal(storeDeleted, true);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
