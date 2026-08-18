import { dirname } from "node:path";
import { isOrphanedSession } from "../orphaned.js";
import { formatSessionAge, shortenPath } from "../session-format.js";
import { optionalService } from "./host.js";
import { idsMatch, sessionIdVariants } from "./ids.js";
export function buildDshSessionLabel(session, index) {
    const age = formatSessionAge(new Date(session.createdAt));
    const cwd = shortenPath(session.cwd || "(unknown cwd)");
    const position = String(index + 1).padStart(3, "0");
    const running = session.running ? " · running" : "";
    return `${position} ${session.title} · ${age} · ${session.id.slice(0, 8)} · ${cwd}${running}`;
}
function archivedIdSet(ctx) {
    const registry = optionalService(ctx, "workspaceRegistry");
    const ids = registry?.archivedSessionIds ?? [];
    return new Set(ids.flatMap((id) => sessionIdVariants(String(id))));
}
function isRunning(ctx, sessionId) {
    const agents = optionalService(ctx, "agents");
    if (!agents || typeof agents.get !== "function") {
        return false;
    }
    return sessionIdVariants(sessionId).some((id) => agents.get(id) !== undefined);
}
export async function listDshSessions(ctx, options) {
    const persistence = optionalService(ctx, "sessionPersistence");
    if (!persistence) {
        throw new Error("DSH sessionPersistence is not mounted; cannot list sessions.");
    }
    const snapshots = await persistence.listSnapshots();
    const archived = archivedIdSet(ctx);
    const listed = [];
    for (const snapshot of snapshots) {
        const header = snapshot.header;
        const id = String(header.id);
        if (options.currentSessionId && idsMatch(id, options.currentSessionId)) {
            continue;
        }
        const isArchived = sessionIdVariants(id).some((variant) => archived.has(variant));
        if (isArchived && !options.includeArchived) {
            continue;
        }
        const location = persistence.locate(header);
        if (!location) {
            continue;
        }
        const cwd = header.cwd ?? "";
        if (options.scope === "current") {
            if (!options.currentCwd || cwd !== options.currentCwd) {
                continue;
            }
        }
        if (options.scope === "orphaned" && !isOrphanedSession({ cwd })) {
            continue;
        }
        const createdAt = typeof header.createdAt === "number" ? header.createdAt : 0;
        listed.push({
            id,
            cwd,
            createdAt,
            path: location.path,
            dir: dirname(location.path),
            title: cwd ? shortenPath(cwd) : id.slice(0, 8),
            archived: isArchived,
            running: isRunning(ctx, id),
        });
    }
    listed.sort((left, right) => right.createdAt - left.createdAt);
    return listed;
}
