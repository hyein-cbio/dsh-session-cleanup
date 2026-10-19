import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { buildSessionSelectionLabel } from "./session-format.js";
import type {
  SessionCleanupSession,
  SessionScope,
  SessionSelectionResult,
} from "./types.js";

const SCOPE_PROMPT: Record<SessionScope, string> = {
  orphaned: "orphaned sessions",
  current: "current-directory sessions",
  all: "sessions",
};

interface ConfirmAction {
  kind: "confirm";
}

interface ToggleAllAction {
  kind: "toggle-all";
}

interface RefreshAction {
  kind: "refresh";
}

interface CancelAction {
  kind: "cancel";
}

interface ToggleSessionAction {
  kind: "toggle-session";
  sessionPath: string;
}

type SelectionAction =
  | ConfirmAction
  | ToggleAllAction
  | RefreshAction
  | CancelAction
  | ToggleSessionAction;

function buildMenu(
  sessions: readonly SessionCleanupSession[],
  selectedPaths: ReadonlySet<string>,
): {
  labels: string[];
  actionsByLabel: Map<string, SelectionAction>;
} {
  const labels: string[] = [];
  const actionsByLabel = new Map<string, SelectionAction>();

  const confirmLabel = `✅ Delete selected (${selectedPaths.size})`;
  labels.push(confirmLabel);
  actionsByLabel.set(confirmLabel, { kind: "confirm" });

  const toggleAllLabel =
    selectedPaths.size === sessions.length
      ? "☐ Clear all selections"
      : "☑ Select all sessions";
  labels.push(toggleAllLabel);
  actionsByLabel.set(toggleAllLabel, { kind: "toggle-all" });

  const refreshLabel = "↻ Refresh session list";
  labels.push(refreshLabel);
  actionsByLabel.set(refreshLabel, { kind: "refresh" });

  const cancelLabel = "✖ Cancel";
  labels.push(cancelLabel);
  actionsByLabel.set(cancelLabel, { kind: "cancel" });

  sessions.forEach((session, index) => {
    const label = buildSessionSelectionLabel(
      session,
      index,
      selectedPaths.has(session.path),
    );
    labels.push(label);
    actionsByLabel.set(label, {
      kind: "toggle-session",
      sessionPath: session.path,
    });
  });

  return { labels, actionsByLabel };
}

async function selectSessionsWithBasicSelector(
  ctx: ExtensionCommandContext,
  sessions: readonly SessionCleanupSession[],
  scope: SessionScope,
): Promise<SessionSelectionResult> {
  const selectedPaths = new Set<string>();
  const prompt = `Select ${SCOPE_PROMPT[scope]} to delete (toggle multiple, then confirm)`;

  while (true) {
    const menu = buildMenu(sessions, selectedPaths);
    const selectedLabel = await ctx.ui.select(prompt, menu.labels);

    if (!selectedLabel) {
      return {
        cancelled: true,
        refreshRequested: false,
        selectedPaths,
      };
    }

    const action = menu.actionsByLabel.get(selectedLabel);
    if (!action) {
      ctx.ui.notify("Unknown selection action. Please try again.", "warning");
      continue;
    }

    switch (action.kind) {
      case "confirm": {
        return {
          cancelled: false,
          refreshRequested: false,
          selectedPaths,
        };
      }
      case "toggle-all": {
        if (selectedPaths.size === sessions.length) {
          selectedPaths.clear();
        } else {
          sessions.forEach((session) => selectedPaths.add(session.path));
        }
        break;
      }
      case "refresh": {
        return {
          cancelled: false,
          refreshRequested: true,
          selectedPaths,
        };
      }
      case "cancel": {
        return {
          cancelled: true,
          refreshRequested: false,
          selectedPaths,
        };
      }
      case "toggle-session": {
        if (selectedPaths.has(action.sessionPath)) {
          selectedPaths.delete(action.sessionPath);
        } else {
          selectedPaths.add(action.sessionPath);
        }
        break;
      }
      default: {
        const unreachable: never = action;
        throw new Error(`Unhandled selection action: ${String(unreachable)}`);
      }
    }
  }
}

export async function selectSessionsForCleanup(
  ctx: ExtensionCommandContext,
  sessions: readonly SessionCleanupSession[],
  scope: SessionScope,
): Promise<SessionSelectionResult> {
  return selectSessionsWithBasicSelector(ctx, sessions, scope);
}
