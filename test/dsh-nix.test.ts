import assert from "node:assert/strict";
import test from "node:test";

import { handleDshNixCommand } from "../src/dsh/nix-command.js";
import { parseDshNixArgs } from "../src/dsh/nix-parse.js";

const oldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("parseDshNixArgs covers fresh, quit, agent, and errors", () => {
  assert.deepEqual(parseDshNixArgs(""), { kind: "fresh" });
  assert.deepEqual(parseDshNixArgs("help"), { kind: "help" });
  assert.deepEqual(parseDshNixArgs("quit"), { kind: "quit" });
  assert.deepEqual(parseDshNixArgs("exit"), { kind: "quit" });
  assert.equal(parseDshNixArgs("quit now").kind, "error");
  assert.deepEqual(parseDshNixArgs("agent"), { kind: "agent" });
  assert.deepEqual(parseDshNixArgs("agent code"), { kind: "agent", targetAgentName: "code" });
  assert.equal(parseDshNixArgs("nope").kind, "error");
});

test("DSH /nix help and cancel", async () => {
  const help = await handleDshNixCommand({ get: () => undefined }, { rawInput: "help" });
  assert.equal(help.kind, "success");
  assert.match(help.text ?? "", /Usage: \/nix/);

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

test("DSH /nix creates a session then deletes the previous one", async () => {
  const created: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];

  const outcome = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
        }
        if (name === "agents") {
          return {
            get: () => undefined,
            create: async (options: Record<string, unknown>) => {
              created.push(options);
              return { agent: { session: { id: options.sessionId } } };
            },
          };
        }
        if (name === "sessions") {
          return {
            get: (id: string) => (id.includes("aaaa") ? { header: { id: oldId } } : undefined),
            store: {
              get: (id: string) => (id.includes("aaaa") ? { session: { id: oldId } } : undefined),
            },
            detachEntered: () => undefined,
          };
        }
        return undefined;
      },
    },
    {
      rawInput: "",
      agent: { session: { id: oldId, header: { cwd: "/work", agentPreset: "standard" } } },
    },
  );

  assert.equal(outcome.kind, "success");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.meta, {
    cwd: "/work",
    parentSession: oldId,
    agentPreset: "standard",
  });
  assert.match(outcome.text ?? "", /New session /);
  assert.match(outcome.text ?? "", /--resume /);
  assert.match(outcome.text ?? "", new RegExp(`Deleted previous session ${oldId}`));
  void deleted;
});

test("DSH /nix agent picks a preset and /nix quit deletes without creating", async () => {
  const created: string[] = [];
  const agentOutcome = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return {
            ask: async (request: { questions: Array<{ id: string; options?: Array<{ label: string }> }> }) => {
              if (request.questions[0]?.id === "pick") {
                return { answers: [{ id: "pick", selected: ["Code"] }] };
              }
              return { answers: [{ id: "confirm", selected: ["Start"] }] };
            },
          };
        }
        if (name === "agentPresets") {
          return {
            list: async () => [
              { id: "standard", name: "Standard" },
              { id: "code", name: "Code", description: "coding" },
            ],
            mount: async () => undefined,
          };
        }
        if (name === "agents") {
          return {
            create: async (options: { sessionId: string; meta?: { agentPreset?: string } }) => {
              created.push(options.meta?.agentPreset ?? "");
              return { agent: { session: { id: options.sessionId } } };
            },
          };
        }
        return undefined;
      },
    },
    { rawInput: "agent", agent: { session: { id: oldId, header: { cwd: "/work" } } } },
  );
  assert.equal(agentOutcome.kind, "success");
  assert.deepEqual(created, ["code"]);

  const explicit = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
        }
        if (name === "agentPresets") {
          return { list: async () => [{ id: "minimal", name: "Minimal" }] };
        }
        if (name === "agents") {
          return {
            create: async (options: { meta?: { agentPreset?: string } }) => {
              created.push(options.meta?.agentPreset ?? "");
              return { agent: { session: { id: "new" } } };
            },
          };
        }
        return undefined;
      },
    },
    { rawInput: "agent Minimal", agent: { session: { header: { cwd: "/work" } } } },
  );
  assert.equal(explicit.kind, "success");
  assert.ok(created.includes("minimal"));

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

test("DSH /nix reports unknown presets and missing create services", async () => {
  const unknown = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "agentPresets") {
          return { list: async () => [{ id: "standard" }] };
        }
        return undefined;
      },
    },
    { rawInput: "agent missing" },
  );
  assert.equal(unknown.kind, "error");
  assert.match(unknown.text ?? "", /Unknown agent preset/);

  const missing = await handleDshNixCommand(
    {
      get(name: string) {
        if (name === "userQuestions") {
          return { ask: async () => ({ answers: [{ id: "confirm", selected: ["Start"] }] }) };
        }
        return undefined;
      },
    },
    { rawInput: "" },
  );
  assert.equal(missing.kind, "error");
  assert.match(missing.text ?? "", /Neither ctx.agents.create nor ctx.sessions.create/);
});
