import { SESSION_NIX_COMMAND } from "../constants.js";
import { handleDshNixCommand } from "./nix-command.js";
import { registerNixCommandTree, registerNixSwitchScene } from "./tui-switch.js";
export const name = "dsh-session-cleanup";
export const inject = ["commands"];
let applied = false;
export function dshPluginApplied() {
    return applied;
}
export function apply(ctx) {
    const commands = ctx.commands ?? ctx.get("commands");
    if (!commands || typeof commands.register !== "function") {
        throw new Error("dsh-session-cleanup requires ctx.commands");
    }
    applied = true;
    const disposers = [
        commands.register({
            name: SESSION_NIX_COMMAND,
            description: "[quit] — delete this session and start a new one; quit also exits DSH",
            input: { hint: "quit | help" },
            handler: async (invocation) => handleDshNixCommand(ctx, {
                agent: invocation.agent,
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
            applied = false;
        });
    }
}
