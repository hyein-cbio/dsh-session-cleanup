import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deleteDshSession, DshDeleteError } from "../src/dsh/delete-session.js";
import { pathExists } from "../src/fs-utils.js";

const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-delete-safe-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const dir = join(root, "sessions", "workspace", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.v4.jsonl.zstd"), "keep private history");
  let attached = true;
  let cache = true;
  let membership = [id];
  let pins = [id];
  const session = { header: { id } };
  const sessions = {
    get: (key: string) => key === id && attached ? session : undefined,
    flush: async () => { assert.equal(attached, true); },
    store: { get: (key: string) => key === id && attached ? { session } : undefined },
    detachEntered: () => { attached = false; },
  };
  const ctx = { get(name: string): unknown {
    if (name === "sessions") return sessions;
    if (name === "storageDomain") return { get(domain: string) {
      if (domain === "session_projcache") return { table: () => ({
        get: (key: string) => key === id && cache ? {} : undefined,
        delete: () => { cache = false; },
      }) };
      if (domain === "workspace") return {
        table: () => ({ entries: () => [["workspace", { sessionIds: membership }]],
          put: (_key: string, value: { sessionIds: string[] }) => { membership = value.sessionIds; } }),
        global: { get: () => ({ pinnedSessionIds: pins }),
          set: (value: { pinnedSessionIds: string[] }) => { pins = value.pinnedSessionIds; } },
      };
    } };
  } };
  return { root, dir, ctx, sessions,
    state: () => ({ attached, cache, membership, pins }),
    close() {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("failed removal preserves live attachment, cache, membership and pins", async () => {
  const f = fixture();
  try {
    await assert.rejects(deleteDshSession(f.ctx, id, {
      removePath: async () => ({ ok: false, error: "Trash unavailable" }),
    }), /could not be removed/);
    assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
    await f.sessions.flush();
    assert.equal(readFileSync(join(f.dir, "session.v4.jsonl.zstd"), "utf8"), "keep private history");
  } finally { f.close(); }
});

test("detach and metadata cleanup happen only after confirmed removal", async () => {
  const f = fixture();
  let attempts = 0;
  try {
    const result = await deleteDshSession(f.ctx, id, { removePath: async target => {
      assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
      if (++attempts < 3) return { ok: false };
      rmSync(target, { recursive: true });
      return { ok: true };
    } });
    assert.equal(result.dirRemoved, true);
    assert.deepEqual(f.state(), { attached: false, cache: false, membership: [], pins: [] });
    assert.equal(existsSync(f.dir), false);
  } finally { f.close(); }
});

function closedHandleError(sessionId = id): Error {
  // Stable public error identity from @deepseek-ai/dsh-session-persistence;
  // the plugin deliberately has no runtime dependency on the host package.
  return Object.assign(new Error(`session "${sessionId}": flush on a closed handle`), {
    name: "SessionHandleClosedError", sessionId,
  });
}

test("a closing old writer must pass the backend durability barrier before removal", async () => {
  const f = fixture();
  const baseGet = f.ctx.get;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let barrierCalls = 0;
  let removed = false;
  f.ctx.get = name => name === "sessionPersistence" ? { flush: async () => {
    barrierCalls++;
    await barrier;
  } } : baseGet(name);
  f.sessions.flush = async () => { throw closedHandleError(); };
  try {
    const deleting = deleteDshSession(f.ctx, id, { removePath: async target => {
      removed = true;
      rmSync(target, { recursive: true });
      return { ok: true };
    } });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(barrierCalls, 1);
    assert.equal(removed, false);
    assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
    release();
    const result = await deleting;
    assert.equal(result.flushed, true);
    assert.equal(result.dirRemoved, true);
    assert.deepEqual(f.state(), { attached: false, cache: false, membership: [], pins: [] });
  } finally { release(); f.close(); }
});

test("closed-writer recovery is narrow and backend failures still refuse deletion", async () => {
  for (const mode of ["absent", "no-flush", "barrier-failure", "other-id", "io-failure", "aggregate"] as const) {
    const f = fixture();
    const baseGet = f.ctx.get;
    let barrierCalls = 0;
    f.ctx.get = name => name === "sessionPersistence"
      ? mode === "absent" ? undefined : mode === "no-flush" ? {} : { flush: async () => {
        barrierCalls++;
        if (mode === "barrier-failure") throw new Error("durability barrier failed");
      } }
      : baseGet(name);
    f.sessions.flush = async () => {
      if (mode === "io-failure") throw new Error("disk full");
      if (mode === "aggregate") throw new AggregateError([closedHandleError(), new Error("disk full")]);
      throw closedHandleError(mode === "other-id" ? "another-session" : id);
    };
    try {
      await assert.rejects(deleteDshSession(f.ctx, id, {
        removePath: async () => { assert.fail("must not delete without a successful durability barrier"); },
      }), error => error instanceof DshDeleteError && error.status === 500
        && /could not flush session/.test(error.message)
        && (mode !== "barrier-failure" || /durability barrier failed/.test(error.message)));
      assert.equal(barrierCalls, mode === "barrier-failure" ? 1 : 0, mode);
      assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
      assert.equal(existsSync(f.dir), true);
    } finally { f.close(); }
  }
});

test("unconfirmed removal cannot be retried by the outer deletion loop", async () => {
  const f = fixture();
  let attempts = 0;
  try {
    await assert.rejects(deleteDshSession(f.ctx, id, { removePath: async () => {
      attempts++;
      return { ok: false, retryable: false, error: "provider still running" };
    } }), /provider still running/);
    assert.equal(attempts, 1);
    assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
  } finally { f.close(); }
});

test("candidate access errors carry status 500 and preserve the live session", async t => {
  if (process.getuid?.() === 0) { t.skip("root bypasses directory permissions"); return; }
  const f = fixture();
  const workspace = join(f.dir, "..");
  chmodSync(workspace, 0);
  try {
    await assert.rejects(deleteDshSession(f.ctx, id), error =>
      error instanceof DshDeleteError && error.status === 500 && /cannot scan/.test(error.message));
    assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
  } finally { chmodSync(workspace, 0o700); f.close(); }
});

test("removal-boundary access errors are normalized and preserve accounting", async () => {
  const f = fixture();
  try {
    await assert.rejects(deleteDshSession(f.ctx, id, { existsDir() { throw new Error("access denied"); } }),
      error => error instanceof DshDeleteError && error.status === 500 && /access denied/.test(error.message));
    assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
  } finally { f.close(); }
});

test("scan errors are not absence and do not touch the host", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-scan-error-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  writeFileSync(join(root, "sessions"), "not a directory");
  try {
    await assert.rejects(deleteDshSession({ get() { assert.fail("must fail before live/storage access"); } }, id), /cannot scan session directory/);
    assert.throws(() => pathExists(join(root, "sessions", "child")), { code: "ENOTDIR" });
    assert.equal(pathExists(join(root, "absent")), false);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("stop and flush failures refuse deletion without detaching or clearing accounting", async () => {
  for (const mode of ["cancel", "idle", "timeout", "flush"] as const) {
    const f = fixture();
    const baseGet = f.ctx.get;
    f.ctx.get = (name: string): unknown => {
      if (name === "agents" && mode !== "flush") return { get: (key: string) => key !== id ? undefined : {
        cancel() { if (mode === "cancel") throw new Error("cancel failed"); },
        whenIdle: () => mode === "timeout" ? new Promise<void>(() => {}) : Promise.reject(new Error("idle failed")),
      } };
      if (name === "sessions" && mode === "flush") return {
        ...f.sessions, flush: async () => { throw new Error("flush failed"); },
      };
      return baseGet(name);
    };
    try {
      await assert.rejects(deleteDshSession(f.ctx, id, {
        idleTimeoutMs: 5,
        removePath: async () => { assert.fail("must not delete on stop/flush failure"); },
      }), /could not (stop|flush) session/);
      assert.deepEqual(f.state(), { attached: true, cache: true, membership: [id], pins: [id] });
      assert.equal(existsSync(f.dir), true);
    } finally { f.close(); }
  }
});
