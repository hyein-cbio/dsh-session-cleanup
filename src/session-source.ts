import {
  SessionManager,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import { enrichSessionWithResponsibleAgent } from "./session-agent.js";
import { isOrphanedSession } from "./orphaned.js";
import { sortSessionsNewestFirst } from "./session-sort.js";
import type { SessionCleanupSession, SessionScope } from "./types.js";

export { isOrphanedSession } from "./orphaned.js";

function ensureSessionArray(value: unknown): SessionCleanupSession[] {
  if (!Array.isArray(value)) {
    throw new Error("Session manager returned a non-array response.");
  }

  return value as SessionCleanupSession[];
}

export async function loadSessions(
  ctx: ExtensionCommandContext,
  scope: SessionScope,
): Promise<SessionCleanupSession[]> {
  const loaded =
    scope === "current"
      ? await SessionManager.list(
          ctx.sessionManager.getCwd(),
          ctx.sessionManager.getSessionDir(),
        )
      : await SessionManager.listAll();

  const sortedSessions = sortSessionsNewestFirst(ensureSessionArray(loaded));
  const scopedSessions =
    scope === "orphaned" ? sortedSessions.filter(isOrphanedSession) : sortedSessions;
  return Promise.all(scopedSessions.map((session) => enrichSessionWithResponsibleAgent(session)));
}
