import { SESSION_CLEANUP_COMMAND, SESSION_NIX_COMMAND } from "../constants.js";
import { handleDshSessionCleanupCommand } from "./command.js";
import type { DshHostContext } from "./host.js";
import { handleDshNixCommand } from "./nix-command.js";

export const name = "dsh-session-cleanup";
export const inject = ["commands"];

let applied = false;

export function dshPluginApplied(): boolean {
  return applied;
}

interface CommandsService {
  register(definition: {
    name: string;
    description: string;
    input?: { hint: string };
    handler: (invocation: {
      agent?: unknown;
      rawInput: string;
      signal?: AbortSignal;
    }) => Promise<{ kind: "success" | "error"; text?: string }>;
  }): () => void;
}

export function apply(ctx: DshHostContext & { commands?: CommandsService; effect?(fn: () => () => void): void }): void {
  const commands = ctx.commands ?? (ctx.get("commands") as CommandsService | undefined);
  if (!commands || typeof commands.register !== "function") {
    throw new Error("dsh-session-cleanup requires ctx.commands");
  }

  applied = true;
  const disposers = [
    commands.register({
      name: SESSION_CLEANUP_COMMAND,
      description:
        "orphaned|current|all | delete <id...> — list and delete DSH sessions",
      input: { hint: "orphaned|current|all | delete <id...>" },
      handler: async (invocation) =>
        handleDshSessionCleanupCommand(ctx, {
          agent: invocation.agent as never,
          rawInput: invocation.rawInput,
          signal: invocation.signal,
        }),
    }),
    commands.register({
      name: SESSION_NIX_COMMAND,
      description:
        "[quit | agent [preset]] — new session and delete current; quit also exits DSH",
      input: { hint: "quit | agent [preset-id] | help" },
      handler: async (invocation) =>
        handleDshNixCommand(ctx, {
          agent: invocation.agent as never,
          rawInput: invocation.rawInput,
          signal: invocation.signal,
        }),
    }),
  ];

  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        dispose();
      }
      applied = false;
    });
  }
}
