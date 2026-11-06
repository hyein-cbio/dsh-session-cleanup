import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleDshNixCommand } from "../src/dsh/nix-command.js";
import { hasPendingNixSwitch, registerNixSwitchScene, switchToNewSession } from "../src/dsh/tui-switch.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(newSession: () => Promise<boolean>, mountImmediately = true) {
  type Props = { React: { useEffect(fn: () => void | (() => void)): void }; channel: { agentId: string; newSession(): Promise<boolean> }; close(): void };
  let component!: (props: Props) => unknown;
  let cleanup: (() => void) | void;
  let closed = 0;
  const mount = () => component({ React: { useEffect(fn) { cleanup = fn(); } },
    channel: { agentId: id, newSession }, close() { closed++; } });
  const ctx = { get(name: string): unknown {
    if (name === "tuiScenes") return {
      register(descriptor: { component: typeof component }) { component = descriptor.component; return () => {}; },
      open() { if (mountImmediately) mount(); return true; },
    };
    if (name === "userQuestions") return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
  } };
  const dispose = registerNixSwitchScene(ctx);
  return { ctx, dispose, mount, unmount: () => cleanup?.(), closed: () => closed };
}

test("switch deadline covers newSession and ignores its late success", { timeout: 2000 }, async () => {
  const gate = deferred<boolean>();
  const f = fixture(() => gate.promise);
  try {
    const result = await switchToNewSession(f.ctx, { timeoutMs: 10 });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Timed out/);
    assert.equal(f.closed(), 1);
    assert.equal(hasPendingNixSwitch(f.ctx), true);
    assert.equal((await switchToNewSession(f.ctx)).ok, false);
    const quit = await handleDshNixCommand(f.ctx, { rawInput: "quit" });
    assert.match(quit.text ?? "", /still settling/);
    gate.resolve(true);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(hasPendingNixSwitch(f.ctx), false);
    assert.equal(result.ok, false);
    assert.equal(f.closed(), 1);
  } finally { gate.resolve(false); f.dispose(); }
});

test("timeout before scene mounting cannot start a stale switch", async () => {
  let called = false;
  const f = fixture(async () => { called = true; return true; }, false);
  try {
    assert.equal((await switchToNewSession(f.ctx, { timeoutMs: 5 })).ok, false);
    f.mount();
    assert.equal(called, false);
  } finally { f.dispose(); }
});

test("abort, unmount and plugin disposal settle pending and running jobs", async () => {
  for (const kind of ["abort", "unmount", "dispose-pending", "dispose-running"]) {
    const gate = deferred<boolean>();
    const f = fixture(() => gate.promise, kind !== "dispose-pending");
    const controller = new AbortController();
    try {
      const pending = switchToNewSession(f.ctx, { signal: controller.signal });
      if (kind === "abort") controller.abort();
      else if (kind === "unmount") f.unmount();
      else f.dispose();
      assert.equal((await pending).ok, false);
      gate.resolve(true);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(hasPendingNixSwitch(f.ctx), false);
    } finally { gate.resolve(false); f.dispose(); }
  }
});

test("separate activation jobs cannot consume or dispose each other", async () => {
  const a = fixture(async () => true, false);
  const b = fixture(async () => true, false);
  try {
    const first = switchToNewSession(a.ctx);
    const second = switchToNewSession(b.ctx);
    a.dispose();
    assert.equal((await first).ok, false);
    b.mount();
    assert.equal((await second).ok, true);
  } finally { a.dispose(); b.dispose(); }
});

test("a thrown scene open settles and permits a retry", async () => {
  const f = fixture(async () => true, false);
  const get = f.ctx.get;
  f.ctx.get = name => name === "tuiScenes" ? { open() { throw new Error("renderer gone"); } } : get(name);
  try {
    assert.match((await switchToNewSession(f.ctx)).error ?? "", /renderer gone/);
    assert.equal(hasPendingNixSwitch(f.ctx), false);
  } finally { f.dispose(); }
});

test("late success after timeout never authorizes command deletion", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-switch-late-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  const log = join(root, "sessions", "project", id, "session.v4.jsonl.zstd");
  mkdirSync(join(log, ".."), { recursive: true });
  writeFileSync(log, "keep after timeout");
  const gate = deferred<boolean>();
  const f = fixture(() => gate.promise);
  try {
    const result = await handleDshNixCommand(f.ctx, { rawInput: "", agent: { session: { id } } }, {
      switchToNewSession: ctx => switchToNewSession(ctx, { timeoutMs: 5 }),
    });
    assert.equal(result.kind, "error");
    gate.resolve(true);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(readFileSync(log, "utf8"), "keep after timeout");
  } finally {
    gate.resolve(false); f.dispose();
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
