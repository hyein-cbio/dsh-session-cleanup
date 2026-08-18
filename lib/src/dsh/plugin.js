import { SESSION_CLEANUP_COMMAND, SESSION_NIX_COMMAND } from "../constants.js";
import { handleDshSessionCleanupCommand } from "./command.js";
import { handleDshNixCommand } from "./nix-command.js";
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
            name: SESSION_CLEANUP_COMMAND,
            description: "orphaned|current|all | delete <id...> — list and delete DSH sessions",
            input: { hint: "orphaned|current|all | delete <id...>" },
            handler: async (invocation) => handleDshSessionCleanupCommand(ctx, {
                agent: invocation.agent,
                rawInput: invocation.rawInput,
                signal: invocation.signal,
            }),
        }),
        commands.register({
            name: SESSION_NIX_COMMAND,
            description: "[quit | agent [preset]] — new session and delete current; quit also exits DSH",
            input: { hint: "quit | agent [preset-id] | help" },
            handler: async (invocation) => handleDshNixCommand(ctx, {
                agent: invocation.agent,
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
