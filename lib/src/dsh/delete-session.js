import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getErrorMessage } from "../error-utils.js";
import { removeSessionArtifact } from "../trash.js";
import { optionalService } from "./host.js";
import { isSessionId, sessionIdVariants } from "./ids.js";
export class DshDeleteError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
function sessionsRoot() {
    return join(dshHome(), "sessions");
}
function findSessionDirsByScan(sessionId) {
    const root = sessionsRoot();
    let entries = [];
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const found = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        for (const variant of sessionIdVariants(sessionId)) {
            const candidate = join(root, entry.name, variant);
            try {
                if (existsSync(candidate) && !found.includes(candidate)) {
                    found.push(candidate);
                }
            }
            catch {
                // keep scanning
            }
        }
    }
    return found;
}
export async function locateSessionDirs(_ctx, sessionId) {
    return findSessionDirsByScan(sessionId);
}
async function stopAgentIfRunning(ctx, sessionId) {
    const agents = optionalService(ctx, "agents");
    if (!agents || typeof agents.get !== "function") {
        return false;
    }
    let stopped = false;
    for (const variant of sessionIdVariants(sessionId)) {
        const agent = agents.get(variant);
        if (!agent) {
            continue;
        }
        stopped = true;
        try {
            agent.cancel?.({ kind: "user" });
        }
        catch {
            // Agent may already be settling.
        }
        if (typeof agent.whenIdle === "function") {
            // This cap has to stay ref'd. Clearing it when idle settles keeps a
            // successful stop from holding the process, but an unref'd timer would
            // let the process exit while whenIdle is still pending.
            let idleTimer;
            try {
                await Promise.race([
                    agent.whenIdle(),
                    new Promise((resolve) => {
                        idleTimer = setTimeout(resolve, 15_000);
                    }),
                ]);
            }
            catch {
                // Proceed with deletion.
            }
            finally {
                if (idleTimer) {
                    clearTimeout(idleTimer);
                }
            }
        }
    }
    return stopped;
}
async function flushSessionIfLive(ctx, sessionId) {
    const sessions = optionalService(ctx, "sessions");
    if (!sessions) {
        return false;
    }
    let flushed = false;
    for (const variant of sessionIdVariants(sessionId)) {
        const session = sessions.get(variant);
        if (!session || typeof sessions.flush !== "function") {
            continue;
        }
        try {
            await sessions.flush(session);
            flushed = true;
        }
        catch {
            // Deletion still proceeds.
        }
    }
    return flushed;
}
function detachLiveSession(ctx, sessionId) {
    const sessions = optionalService(ctx, "sessions");
    if (!sessions) {
        return false;
    }
    let detached = false;
    try {
        const store = sessions.store;
        for (const variant of sessionIdVariants(sessionId)) {
            const entry = store && typeof store.get === "function" ? store.get(variant) : undefined;
            if (entry === undefined) {
                continue;
            }
            if (typeof sessions.detachEntered === "function") {
                sessions.detachEntered(entry);
                detached = true;
                continue;
            }
            if (store && typeof store.delete === "function") {
                store.delete(variant);
                detached = true;
            }
        }
    }
    catch {
        // Live detach is best-effort; disk cleanup still runs.
    }
    return detached;
}
async function trashTargets(targets, hooks) {
    const sendToTrash = hooks.removePath ?? removeSessionArtifact;
    const exists = hooks.existsDir ?? existsSync;
    let removed = false;
    const errors = [];
    for (const target of targets) {
        if (!exists(target)) {
            continue;
        }
        const result = await sendToTrash(target);
        if (result.ok && !exists(target)) {
            removed = true;
            continue;
        }
        if (result.error) {
            errors.push(`${target}: ${result.error}`);
        }
    }
    return {
        removed,
        ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
    };
}
async function stripStorageDomains(ctx, sessionId, options) {
    const storage = optionalService(ctx, "storageDomain");
    if (!storage) {
        return { projRemoved: false, workspaceRemoved: false };
    }
    const variants = sessionIdVariants(sessionId);
    let projRemoved = false;
    let workspaceRemoved = false;
    const proj = storage.get("session_projcache");
    if (proj && typeof proj.table === "function") {
        try {
            const table = proj.table("sessions");
            for (const variant of variants) {
                if (table.get(variant) !== undefined) {
                    await table.delete(variant);
                    projRemoved = true;
                }
            }
        }
        catch {
            // Unit closed or table absent.
        }
    }
    if (!options.workspace) {
        return { projRemoved, workspaceRemoved };
    }
    const workspace = storage.get("workspace");
    if (workspace && typeof workspace.table === "function") {
        try {
            const table = workspace.table("workspaces");
            for (const [workspaceId, record] of table.entries()) {
                if (!record || typeof record !== "object") {
                    continue;
                }
                const sessionIds = record.sessionIds;
                if (!Array.isArray(sessionIds) || !sessionIds.some((id) => variants.includes(String(id)))) {
                    continue;
                }
                if (typeof table.put !== "function") {
                    continue;
                }
                await table.put(workspaceId, {
                    ...record,
                    sessionIds: sessionIds.filter((id) => !variants.includes(String(id))),
                });
                workspaceRemoved = true;
            }
        }
        catch {
            // Unit closed or table absent.
        }
        try {
            const globalState = workspace.global;
            if (globalState && typeof globalState.get === "function" && typeof globalState.set === "function") {
                const state = globalState.get();
                const archived = state?.archivedSessionIds;
                const pinned = state?.pinnedSessionIds;
                const nextArchived = Array.isArray(archived)
                    ? archived.filter((id) => !variants.includes(String(id)))
                    : undefined;
                const nextPinned = Array.isArray(pinned)
                    ? pinned.filter((id) => !variants.includes(String(id)))
                    : undefined;
                const archivedHit = Array.isArray(archived) && nextArchived !== undefined && nextArchived.length !== archived.length;
                const pinnedHit = Array.isArray(pinned) && nextPinned !== undefined && nextPinned.length !== pinned.length;
                if (archivedHit || pinnedHit) {
                    await globalState.set({
                        ...state,
                        ...(archivedHit ? { archivedSessionIds: nextArchived } : {}),
                        ...(pinnedHit ? { pinnedSessionIds: nextPinned } : {}),
                    });
                    workspaceRemoved = true;
                }
            }
        }
        catch {
            // No global slot.
        }
    }
    return { projRemoved, workspaceRemoved };
}
export async function deleteDshSession(ctx, sessionId, hooks = {}) {
    const trimmed = sessionId.trim();
    if (!isSessionId(trimmed)) {
        throw new DshDeleteError(`invalid session id: ${sessionId}`, 400);
    }
    const stopped = await stopAgentIfRunning(ctx, trimmed);
    const flushed = await flushSessionIfLive(ctx, trimmed);
    const detached = detachLiveSession(ctx, trimmed);
    // Ref'd on purpose. wait(0) is a yield between trash attempts; unref() lets
    // Node exit while deleteDshSession is still running when nothing else is
    // keeping the event loop alive.
    const wait = hooks.wait ?? ((ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    }));
    const exists = hooks.existsDir ?? existsSync;
    let firstDirs = await locateSessionDirs(ctx, trimmed);
    const firstTrash = await trashTargets(firstDirs, hooks);
    const projOnly = await stripStorageDomains(ctx, trimmed, { workspace: false });
    firstDirs = await locateSessionDirs(ctx, trimmed);
    const secondTrash = await trashTargets(firstDirs, hooks);
    await wait(0);
    firstDirs = await locateSessionDirs(ctx, trimmed);
    const thirdTrash = await trashTargets(firstDirs, hooks);
    const remaining = (await locateSessionDirs(ctx, trimmed)).filter((dir) => exists(dir));
    if (remaining.length > 0) {
        const trashError = thirdTrash.error ?? secondTrash.error ?? firstTrash.error;
        throw new DshDeleteError(`session files could not be removed: ${remaining.join(", ")}${trashError ? ` (${trashError})` : ""}`, 500);
    }
    const workspaceStorage = await stripStorageDomains(ctx, trimmed, { workspace: true });
    const dirRemoved = firstTrash.removed || secondTrash.removed || thirdTrash.removed;
    const projRemoved = projOnly.projRemoved || workspaceStorage.projRemoved;
    const workspaceRemoved = workspaceStorage.workspaceRemoved;
    if (!dirRemoved && !projRemoved && !workspaceRemoved && !detached) {
        throw new DshDeleteError(`session not found: ${trimmed}`, 404);
    }
    return {
        stopped,
        flushed,
        detached,
        dirRemoved,
        projRemoved,
        workspaceRemoved,
    };
}
export function describeDeleteFailure(error) {
    return getErrorMessage(error);
}
