import { SESSION_NIX_COMMAND } from "../constants.js";
import { confirmAction, userQuestionsOf } from "./ask.js";
import { deleteDshSession, DshDeleteError } from "./delete-session.js";
import { optionalService, type DshHostContext } from "./host.js";
import {
  commandResult,
  currentSessionId,
  type CommandResult,
  type DshCommandInvocation,
} from "./invocation.js";
import { dshNixUsage, parseDshNixArgs } from "./nix-parse.js";
import { switchToNewSession, type TuiSwitchResult } from "./tui-switch.js";

export interface DshNixHooks {
  exitProcess?: (code: number) => void;
  disposeRoot?: () => Promise<void>;
  switchToNewSession?: (ctx: DshHostContext) => Promise<TuiSwitchResult>;
}

interface FiberHost {
  root?: { fiber?: { dispose?: () => Promise<void> | void } };
}

interface TuiToastLike {
  show(text: string, options?: { color?: "success" | "warning" | "error"; timeoutMs?: number }): boolean;
}

function notifyHost(
  ctx: DshHostContext,
  text: string,
  color?: "success" | "warning" | "error",
): void {
  const toast = optionalService<TuiToastLike>(ctx, "tuiToast");
  toast?.show(text, { ...(color ? { color } : {}), timeoutMs: 6000 });
}

async function quitHost(ctx: DshHostContext, hooks: DshNixHooks): Promise<void> {
  const exitProcess = hooks.exitProcess ?? ((code: number) => {
    process.exit(code);
  });
  const host = ctx as DshHostContext & FiberHost;
  const disposeRoot = hooks.disposeRoot
    ?? (typeof host.root?.fiber?.dispose === "function"
      ? async () => {
          await host.root!.fiber!.dispose!();
        }
      : undefined);

  if (!disposeRoot) {
    exitProcess(0);
    return;
  }

  const timer = setTimeout(() => exitProcess(0), 5_000);
  timer.unref?.();
  try {
    await disposeRoot();
  } finally {
    clearTimeout(timer);
    exitProcess(0);
  }
}

async function deleteCurrentSession(
  ctx: DshHostContext,
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (!sessionId) {
    return undefined;
  }
  try {
    await deleteDshSession(ctx, sessionId);
    return undefined;
  } catch (error) {
    if (error instanceof DshDeleteError && error.status === 404) {
      return undefined;
    }
    const message = error instanceof DshDeleteError ? error.message : String(error);
    return message;
  }
}

export async function handleDshNixCommand(
  ctx: DshHostContext,
  invocation: DshCommandInvocation,
  hooks: DshNixHooks = {},
): Promise<CommandResult> {
  const parsed = parseDshNixArgs(invocation.rawInput);
  if (parsed.kind === "help") {
    return commandResult("success", dshNixUsage());
  }
  if (parsed.kind === "error") {
    return commandResult("error", `${parsed.error}\n${dshNixUsage()}`);
  }

  const oldId = currentSessionId(invocation);
  const questions = userQuestionsOf(ctx);

  try {
    if (parsed.kind === "quit") {
      const confirmed = await confirmAction(
        questions,
        invocation,
        "Delete the current session?",
        oldId
          ? `This removes ${oldId} through the host cleanup chain, then exits DSH.`
          : "There is no current session id to delete. DSH will still exit.",
        "Delete and quit",
      );
      if (!confirmed) {
        return commandResult("success", `/${SESSION_NIX_COMMAND} quit cancelled.`);
      }
      const deleteError = await deleteCurrentSession(ctx, oldId);
      if (deleteError) {
        return commandResult("error", `Deleted nothing.\n${deleteError}`);
      }
      const summary = oldId ? `Deleted ${oldId}. Exiting.` : "No current session to delete. Exiting.";
      await quitHost(ctx, hooks);
      return commandResult("success", summary);
    }

    const confirmed = await confirmAction(
      questions,
      invocation,
      "Delete this session and start a new one?",
      [
        oldId ? `Current session: ${oldId}` : "No current session id is available to delete.",
        "dsh-tui will switch the live view to the new session.",
        "On macOS the old session directory goes to Trash. On other platforms it is permanently removed.",
      ].join("\n"),
      "Start",
    );
    if (!confirmed) {
      return commandResult("success", `/${SESSION_NIX_COMMAND} cancelled.`);
    }

    const startFresh = hooks.switchToNewSession ?? switchToNewSession;
    const switched = await startFresh(ctx);
    if (!switched.ok) {
      return commandResult("error", switched.error ?? "Could not start a new session.");
    }

    const previousId = switched.previousSessionId || oldId;
    const deleteError = await deleteCurrentSession(ctx, previousId);
    if (deleteError) {
      notifyHost(
        ctx,
        `New session started, but the previous session could not be deleted: ${deleteError}`,
        "warning",
      );
      return commandResult(
        "success",
        `New session started. The previous session could not be deleted: ${deleteError}`,
      );
    }

    const summary = previousId
      ? "New session started. Previous session deleted."
      : "New session started.";
    notifyHost(ctx, summary, "success");
    return commandResult("success", summary);
  } catch (error) {
    return commandResult("error", error instanceof Error ? error.message : String(error));
  }
}
