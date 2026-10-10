import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { deleteSessionFileSync } from "./session-delete.js";
import { getErrorMessage } from "./error-utils.js";
import type { DeleteSessionResult } from "./types.js";

export type QuitShutdownReason = "quit" | "reload" | "new" | "resume" | "fork";

interface ArmedQuitDeletion {
  sessionFile: string;
  ctx: ExtensionContext;
  deleteSync: (sessionPath: string) => DeleteSessionResult;
}

let pendingSessionFileForQuitDeletion: string | undefined;
let armedQuitDeletion: ArmedQuitDeletion | undefined;

export function scheduleSessionDeletionForQuit(sessionFile: string | undefined): void {
  pendingSessionFileForQuitDeletion = sessionFile;
}

export function clearScheduledSessionDeletionForQuit(): void {
  pendingSessionFileForQuitDeletion = undefined;
  disarmQuitDeletion();
}

function disarmQuitDeletion(): void {
  if (!armedQuitDeletion) {
    return;
  }

  armedQuitDeletion = undefined;
  process.off("exit", runArmedQuitDeletion);
}

function notifyQuitDeletionFailure(ctx: ExtensionContext, error: string): void {
  try {
    ctx.ui.notify(
      `Failed to delete the current session during shutdown: ${error}`,
      "warning",
    );
  } catch {
    // The TUI is already stopped by the time process exit runs.
  }
}

/** Test hook for the process `exit` listener. Pi exits before async deletion can run. */
export function runArmedQuitDeletion(): void {
  const armed = armedQuitDeletion;
  if (!armed) {
    return;
  }

  disarmQuitDeletion();
  try {
    const deleteResult = armed.deleteSync(armed.sessionFile);
    if (!deleteResult.ok) {
      notifyQuitDeletionFailure(armed.ctx, deleteResult.error);
    }
  } catch (error) {
    notifyQuitDeletionFailure(armed.ctx, getErrorMessage(error));
  }
}

/**
 * Arm deletion for process exit. Deleting inside `session_shutdown` lets a
 * later extension recreate the file with `appendEntry()`.
 */
export async function flushScheduledSessionDeletionForQuit(
  ctx: ExtensionContext,
  options: {
    reason?: QuitShutdownReason;
    deleteSync?: (sessionPath: string) => DeleteSessionResult;
  } = {},
): Promise<void> {
  if (options.reason && options.reason !== "quit") {
    return;
  }

  const sessionFile = pendingSessionFileForQuitDeletion;
  pendingSessionFileForQuitDeletion = undefined;
  if (!sessionFile) {
    return;
  }

  disarmQuitDeletion();
  armedQuitDeletion = {
    sessionFile,
    ctx,
    deleteSync: options.deleteSync ?? deleteSessionFileSync,
  };
  process.on("exit", runArmedQuitDeletion);
}
