import { SESSION_CLEANUP_COMMAND } from "../constants.js";
import { optionalService, type DshHostContext } from "./host.js";
import { idsMatch } from "./ids.js";
import {
  buildDshSessionLabel,
  listDshSessions,
  type DshListedSession,
} from "./list-sessions.js";
import { deleteDshSession, DshDeleteError } from "./delete-session.js";
import { dshCleanupUsage, parseDshSessionCleanupArgs } from "./parse.js";

interface CommandResult {
  kind: "success" | "error";
  text?: string;
}

interface AskOption {
  label: string;
  description?: string;
}

interface UserQuestionsLike {
  ask(request: {
    questions: Array<{
      id: string;
      question: string;
      detail?: string;
      options?: AskOption[];
      multiSelect?: boolean;
    }>;
    agent?: unknown;
    signal?: AbortSignal;
  }): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>;
}

interface DshCommandInvocation {
  agent?: {
    session?: { id?: unknown; header?: { cwd?: unknown } };
    options?: { cwd?: unknown };
  };
  rawInput: string;
  signal?: AbortSignal;
}

function currentSessionId(invocation: DshCommandInvocation): string | undefined {
  const id = invocation.agent?.session?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function currentCwd(invocation: DshCommandInvocation): string | undefined {
  const headerCwd = invocation.agent?.session?.header?.cwd;
  if (typeof headerCwd === "string" && headerCwd.length > 0) {
    return headerCwd;
  }
  const optionCwd = invocation.agent?.options?.cwd;
  return typeof optionCwd === "string" && optionCwd.length > 0 ? optionCwd : undefined;
}

function result(kind: "success" | "error", text: string): CommandResult {
  return { kind, text };
}

async function confirmDelete(
  questions: UserQuestionsLike | undefined,
  invocation: DshCommandInvocation,
  sessions: readonly DshListedSession[],
): Promise<boolean> {
  if (!questions) {
    return true;
  }

  const running = sessions.filter((session) => session.running).length;
  const preview = sessions
    .slice(0, 8)
    .map((session, index) => `- ${buildDshSessionLabel(session, index)}`)
    .join("\n");
  const hidden = Math.max(0, sessions.length - 8);
  const detail = [
    preview,
    hidden > 0 ? `- …and ${hidden} more` : "",
    running > 0 ? `\n${running} selected session(s) are running and will be stopped.` : "",
    "On macOS this sends the DSH session directory and sidecar to Trash. On other platforms it permanently removes them. Then it clears projection cache and workspace accounting.",
  ]
    .filter(Boolean)
    .join("\n");

  const answer = await questions.ask({
    questions: [
      {
        id: "confirm",
        question: `Delete ${sessions.length} selected session(s)?`,
        detail,
        options: [{ label: "Delete" }, { label: "Cancel" }],
      },
    ],
    agent: invocation.agent,
    signal: invocation.signal,
  });
  return answer.answers.some((item) => item.id === "confirm" && item.selected.includes("Delete"));
}

async function pickSessions(
  questions: UserQuestionsLike,
  invocation: DshCommandInvocation,
  sessions: readonly DshListedSession[],
): Promise<DshListedSession[] | "cancelled"> {
  const options = sessions.map((session, index) => ({
    label: buildDshSessionLabel(session, index),
    description: session.id,
  }));

  const answer = await questions.ask({
    questions: [
      {
        id: "sessions",
        question: "Select sessions to delete",
        detail: "Space/multi-select if the UI allows it. Cancel leaves everything untouched.",
        options,
        multiSelect: true,
      },
    ],
    agent: invocation.agent,
    signal: invocation.signal,
  });

  const selected = new Set(
    answer.answers.find((item) => item.id === "sessions")?.selected ?? [],
  );
  if (selected.size === 0) {
    return "cancelled";
  }

  return sessions.filter((session, index) => selected.has(buildDshSessionLabel(session, index)));
}

function formatDeleteOutcome(
  session: DshListedSession,
  outcome: Awaited<ReturnType<typeof deleteDshSession>>,
): string {
  const parts = [
    outcome.dirRemoved ? "log" : null,
    outcome.projRemoved ? "cache" : null,
    outcome.workspaceRemoved ? "workspace" : null,
    outcome.sidecarRemoved ? "sidecar" : null,
    outcome.stopped ? "stopped" : null,
  ].filter(Boolean);
  return `- ${session.id.slice(0, 8)} (${session.title}): ${parts.join(", ") || "removed"}`;
}

export async function handleDshSessionCleanupCommand(
  ctx: DshHostContext,
  invocation: DshCommandInvocation,
): Promise<CommandResult> {
  const parsed = parseDshSessionCleanupArgs(invocation.rawInput);
  if (parsed.kind === "help") {
    return result("success", dshCleanupUsage());
  }
  if (parsed.kind === "error") {
    return result("error", `${parsed.error}\n${dshCleanupUsage()}`);
  }

  const liveId = currentSessionId(invocation);
  const cwd = currentCwd(invocation);
  const questions = optionalService<UserQuestionsLike>(ctx, "userQuestions");

  try {
    const listed = await listDshSessions(ctx, {
      scope: parsed.kind === "list" ? parsed.scope : "all",
      currentCwd: cwd,
      currentSessionId: liveId,
      includeArchived: parsed.kind === "delete",
    });

    let selected: DshListedSession[];
    if (parsed.kind === "delete") {
      selected = listed.filter((session) =>
        parsed.ids.some((id) => idsMatch(session.id, id)),
      );
      const missing = parsed.ids.filter(
        (id) => !selected.some((session) => idsMatch(session.id, id)),
      );
      if (missing.length > 0 && selected.length === 0) {
        return result("error", `No matching sessions: ${missing.join(", ")}`);
      }
    } else if (listed.length === 0) {
      const empty =
        parsed.scope === "orphaned"
          ? "No orphaned sessions found (every listed session still has a matching directory)."
          : "No deletable sessions found for this scope (the active session is excluded).";
      return result("success", empty);
    } else if (questions) {
      const picked = await pickSessions(questions, invocation, listed);
      if (picked === "cancelled") {
        return result("success", "Session cleanup cancelled.");
      }
      selected = picked;
    } else {
      const preview = listed
        .map((session, index) => `- ${buildDshSessionLabel(session, index)}`)
        .join("\n");
      return result(
        "success",
        [
          `Found ${listed.length} session(s) for scope '${parsed.scope}'.`,
          "This host has no user-questions service, so nothing was deleted.",
          `Delete explicitly with: /${SESSION_CLEANUP_COMMAND} delete <session-id> [session-id...]`,
          "",
          preview,
        ].join("\n"),
      );
    }

    if (selected.length === 0) {
      return result("error", "No sessions selected.");
    }

    const confirmed = await confirmDelete(questions, invocation, selected);
    if (!confirmed) {
      return result("success", "Delete cancelled.");
    }

    const deleted: string[] = [];
    const failed: string[] = [];
    for (const session of selected) {
      if (liveId && idsMatch(session.id, liveId)) {
        failed.push(`- ${session.id.slice(0, 8)}: refused to delete the active session`);
        continue;
      }
      try {
        const outcome = await deleteDshSession(ctx, session.id);
        deleted.push(formatDeleteOutcome(session, outcome));
      } catch (error) {
        const message = error instanceof DshDeleteError ? error.message : String(error);
        failed.push(`- ${session.id.slice(0, 8)} (${session.title}): ${message}`);
      }
    }

    if (deleted.length === 0) {
      return result("error", `No sessions were deleted.\n${failed.join("\n")}`);
    }
    if (failed.length === 0) {
      return result("success", `Deleted ${deleted.length} session(s).\n${deleted.join("\n")}`);
    }
    return result(
      "success",
      `Deleted ${deleted.length} session(s), but ${failed.length} failed.\n${deleted.join("\n")}\n${failed.join("\n")}`,
    );
  } catch (error) {
    return result("error", error instanceof Error ? error.message : String(error));
  }
}
