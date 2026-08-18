import { SESSION_NIX_COMMAND } from "../constants.js";
export function dshNixUsage() {
    return [
        `Usage: /${SESSION_NIX_COMMAND}`,
        `       /${SESSION_NIX_COMMAND} quit`,
        `       /${SESSION_NIX_COMMAND} agent [preset-id]`,
        `       /${SESSION_NIX_COMMAND} help`,
        "",
        "Starts a new DSH session, then deletes the current one through the host cleanup chain.",
        "The host keeps showing the old session until you resume the new id.",
        "On macOS the old session directory goes to Trash; elsewhere it is permanently removed.",
        `/${SESSION_NIX_COMMAND} quit deletes the current session and then exits DSH.`,
    ].join("\n");
}
export function parseDshNixArgs(args) {
    const trimmed = args.trim();
    if (!trimmed) {
        return { kind: "fresh" };
    }
    const parts = trimmed.split(/\s+/u);
    const command = parts[0]?.toLowerCase();
    if (!command) {
        return { kind: "fresh" };
    }
    if (command === "help") {
        return { kind: "help" };
    }
    if (command === "quit" || command === "exit") {
        return parts.length === 1
            ? { kind: "quit" }
            : { kind: "error", error: `/${SESSION_NIX_COMMAND} quit does not accept additional arguments.` };
    }
    if (command === "agent") {
        return {
            kind: "agent",
            ...(parts.length > 1 ? { targetAgentName: parts.slice(1).join(" ") } : {}),
        };
    }
    return { kind: "error", error: `Unknown argument: ${trimmed}` };
}
