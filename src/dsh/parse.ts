import type { SessionScope } from "../types.js";

export type DshCleanupArgs =
  | { kind: "help" }
  | { kind: "list"; scope: SessionScope }
  | { kind: "delete"; ids: string[] }
  | { kind: "error"; error: string };

export function dshCleanupUsage(): string {
  return [
    "Usage: /session-cleanup [orphaned|current|all]",
    "       /session-cleanup delete <session-id> [session-id...]",
    "       /session-cleanup help",
    "",
    "Default lists orphaned sessions (cwd directory is gone).",
    "Deletion uses the DSH host cleanup chain (live stop/flush/detach, then remove the session directory, then clear projection cache and workspace accounting).",
    "On macOS the session directory goes to Trash. On other platforms it is permanently removed.",
  ].join("\n");
}

export function parseDshSessionCleanupArgs(args: string): DshCleanupArgs {
  const tokens = args.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) {
    return { kind: "list", scope: "orphaned" };
  }

  const head = tokens[0]!.toLowerCase();
  if (head === "help") {
    return { kind: "help" };
  }

  if (head === "delete") {
    const ids = tokens.slice(1);
    if (ids.length === 0) {
      return {
        kind: "error",
        error: "Usage: /session-cleanup delete <session-id> [session-id...]",
      };
    }
    return { kind: "delete", ids };
  }

  if (head === "orphaned" || head === "current" || head === "all") {
    if (tokens.length > 1) {
      return { kind: "error", error: `Unexpected extra arguments: ${tokens.slice(1).join(" ")}` };
    }
    return { kind: "list", scope: head };
  }

  return { kind: "error", error: `Unknown argument: ${tokens[0]}` };
}
