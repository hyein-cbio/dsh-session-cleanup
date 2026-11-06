import { SESSION_NIX_COMMAND } from "../constants.js";
import type { DshHostContext } from "./host.js";
import { handleDshNixCommand } from "./nix-command.js";
import { registerNixCommandTree, registerNixSwitchScene } from "./tui-switch.js";

export const name = "dsh-session-cleanup";
// Wait for the TUI before activation: scene registration and command execution
// must share one Cordis owner, including when the TUI starts after this plugin.
export const inject = ["commands", "tuiScenes"];

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

export function apply(ctx: DshHostContext & {
  commands?: CommandsService;
  effect?(fn: () => () => void): void;
}): void {
  const commands = ctx.commands ?? (ctx.get("commands") as CommandsService | undefined);
  if (!commands || typeof commands.register !== "function") {
    throw new Error("dsh-session-cleanup requires ctx.commands");
  }

  const disposers = [
    commands.register({
      name: SESSION_NIX_COMMAND,
      description: "[quit] — delete this session and start a new one; quit also exits DSH",
      input: { hint: "quit | help" },
      handler: async (invocation) =>
        handleDshNixCommand(ctx, {
          agent: invocation.agent as never,
          rawInput: invocation.rawInput,
          signal: invocation.signal,
        }),
    }),
    registerNixSwitchScene(ctx),
    registerNixCommandTree(ctx),
  ];

  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        dispose();
      }
    });
  }
}
