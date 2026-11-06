import assert from "node:assert/strict";
import test from "node:test";

import { confirmAction } from "../src/dsh/ask.js";
import { handleDshSessionCleanupCommand } from "../src/dsh/command.js";
import { handleDshNixCommand } from "../src/dsh/nix-command.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("missing or aborted confirmation never grants destructive consent", async () => {
  assert.equal(await confirmAction(undefined, { rawInput: "" }, "Delete?", "details"), false);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await confirmAction({ ask: async () => { assert.fail("already aborted"); } },
    { rawInput: "", signal: controller.signal }, "Delete?", "details"), false);
  const lateAbort = new AbortController();
  assert.equal(await confirmAction({ ask: async () => {
    lateAbort.abort();
    return { answers: [{ id: "confirm", selected: ["Confirm"] }] };
  } }, { rawInput: "", signal: lateAbort.signal }, "Delete?", "details"), false);
});

test("both nix forms refuse missing confirmation without cleanup or exit", async () => {
  for (const rawInput of ["", "quit"]) {
    const result = await handleDshNixCommand({ get(name) {
      assert.equal(name, "userQuestions");
      return undefined;
    } }, { rawInput, agent: { session: { id } } }, {
      exitProcess: () => assert.fail("must not exit"),
      switchToNewSession: async () => { assert.fail("must not switch"); },
    });
    assert.equal(result.kind, "error");
    assert.match(result.text ?? "", /Confirmation is unavailable/);
  }
});

function legacyHost(ask?: (request: { questions: Array<{ id: string; options?: Array<{ label: string }> }> }) => Promise<unknown>) {
  return { get(name: string): unknown {
    if (name === "sessionPersistence") return {
      listSnapshots: async () => [{ header: { id, createdAt: 941000, cwd: "/workspace" } }],
      locate: () => ({ kind: "jsonl", path: "/unused/session.v4.jsonl.zstd" }),
    };
    if (name === "userQuestions") return ask ? { ask } : undefined;
    if (name === "workspaceRegistry") return { archivedSessionIds: [] };
    if (name === "agents") return { get: () => undefined };
    assert.fail(`must not clean ${name}`);
  } };
}

test("legacy explicit delete also refuses missing confirmation", async () => {
  const result = await handleDshSessionCleanupCommand(legacyHost(), { rawInput: `delete ${id}` });
  assert.equal(result.kind, "error");
  assert.match(result.text ?? "", /Confirmation is unavailable/);
});

test("legacy picker resolves original labels across age boundaries", async t => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  let asks = 0;
  const result = await handleDshSessionCleanupCommand(legacyHost(async request => {
    asks++;
    if (request.questions[0].id === "sessions") {
      const label = request.questions[0].options![0].label;
      assert.match(label, /now/);
      now += 2000;
      return { answers: [{ id: "sessions", selected: [label] }] };
    }
    return { answers: [{ id: "confirm", selected: ["Cancel"] }] };
  }), { rawInput: "all" });
  assert.equal(asks, 2);
  assert.equal(result.text, "Delete cancelled.");
});

test("abort after a completed switch preserves the previous session", async () => {
  const controller = new AbortController();
  const result = await handleDshNixCommand({ get(name) {
    if (name === "userQuestions") return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
    assert.fail(`must not delete through ${name}`);
  } }, { rawInput: "", signal: controller.signal }, { switchToNewSession: async () => {
    controller.abort();
    return { ok: true, previousSessionId: id };
  } });
  assert.equal(result.kind, "error");
  assert.match(result.text ?? "", /cancelled after the switch/);
});


test("nix commands are serialized during confirmation and release their lock on cancel", async () => {
  let answer!: (value: { answers: Array<{ id: string; selected: string[] }> }) => void;
  const ctx = { get: () => ({ ask: () => new Promise(resolve => { answer = resolve; }) }) };
  const first = handleDshNixCommand(ctx, { rawInput: "" });
  const second = await handleDshNixCommand(ctx, { rawInput: "quit" });
  assert.equal(second.kind, "error");
  assert.match(second.text ?? "", /still settling/);
  answer({ answers: [{ id: "confirm", selected: ["Cancel"] }] });
  assert.match((await first).text ?? "", /cancelled/);
  const third = handleDshNixCommand(ctx, { rawInput: "quit" });
  answer({ answers: [{ id: "confirm", selected: ["Cancel"] }] });
  assert.match((await third).text ?? "", /cancelled/);
});
