import assert from "node:assert/strict";
import test from "node:test";

import { handleDshNixCommand } from "../src/dsh/nix-command.js";
import { parseDshNixArgs } from "../src/dsh/nix-parse.js";

const oldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("parseDshNixArgs covers fresh, quit, and errors", () => {
  assert.deepEqual(parseDshNixArgs(""), { kind: "fresh" });
  assert.deepEqual(parseDshNixArgs("help"), { kind: "help" });
  assert.deepEqual(parseDshNixArgs("quit"), { kind: "quit" });
  assert.deepEqual(parseDshNixArgs("exit"), { kind: "quit" });
  assert.equal(parseDshNixArgs("quit now").kind, "error");
  assert.equal(parseDshNixArgs("agent").kind, "error");
  assert.equal(parseDshNixArgs("nope").kind, "error");
});

test("DSH /nix help and cancel", async () => {
  const help = await handleDshNixCommand({ get: () => undefined }, { rawInput: "help" });
  assert.equal(help.kind, "success");
  assert.match(help.text ?? "", /Usage: \/nix/);
  assert.doesNotMatch(help.text ?? "", /agent/);

  const cancelled = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Cancel"] }] }) };
        }
        return undefined;
      },
    },
    { rawInput: "", agent: { session: { id: oldId, header: { cwd: "/work" } } } },
  );
  assert.match(cancelled.text ?? "", /cancelled/);
});

test("DSH /nix switches the live view then deletes the previous session", async () => {
  const toasts: string[] = [];
  let created = false;

  const outcome = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
        }
        if (name === "tuiToast") {
          return {
            show(text: string) {
              toasts.push(text);
              return true;
            },
          };
        }
        if (name === "agents") {
          return {
            get: () => undefined,
            create: async () => {
              created = true;
              return { agent: { session: { id: "should-not-create" } } };
            },
          };
        }
        return undefined;
      },
    },
    {
      rawInput: "",
      agent: { session: { id: oldId, header: { cwd: "/work" } } },
    },
    {
      switchToNewSession: async () => ({ ok: true, previousSessionId: oldId }),
    },
  );

  assert.equal(outcome.kind, "success");
  assert.equal(created, false);
  assert.match(outcome.text ?? "", /New session started/);
  assert.match(outcome.text ?? "", /Previous session deleted/);
  assert.equal(toasts.at(-1), "New session started. Previous session deleted.");
});

test("DSH /nix does not delete when the TUI refuses to switch", async () => {
  const outcome = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
        }
        return undefined;
      },
    },
    { rawInput: "", agent: { session: { id: oldId } } },
    {
      switchToNewSession: async () => ({
        ok: false,
        previousSessionId: oldId,
        error: "dsh-tui refused to start a new session (it may be working).",
      }),
    },
  );
  assert.equal(outcome.kind, "error");
  assert.match(outcome.text ?? "", /refused to start a new session/);
});

test("DSH /nix reports a missing TUI switcher", async () => {
  const outcome = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
        }
        return undefined;
      },
    },
    { rawInput: "", agent: { session: { id: oldId } } },
  );
  assert.equal(outcome.kind, "error");
  assert.match(outcome.text ?? "", /needs dsh-tui/);
});

test("DSH /nix quit deletes without creating and exits", async () => {
  let createdOnQuit = false;
  let exitCode: number | undefined;
  let disposed = false;
  const quit = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Delete and quit"] }] }) };
        }
        if (name === "agents") {
          return {
            create: async () => {
              createdOnQuit = true;
              return { agent: { session: { id: "nope" } } };
            },
          };
        }
        return undefined;
      },
    },
    { rawInput: "quit", agent: { session: { id: oldId } } },
    {
      disposeRoot: async () => {
        disposed = true;
      },
      exitProcess: (code) => {
        exitCode = code;
      },
    },
  );
  assert.equal(createdOnQuit, false);
  assert.equal(quit.kind, "success");
  assert.equal(disposed, true);
  assert.equal(exitCode, 0);
  assert.match(quit.text ?? "", /Exiting/);
});
