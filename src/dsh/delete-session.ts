import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getErrorMessage } from "../error-utils.js";
import { removeSessionArtifact } from "../trash.js";
import { optionalService, type DshHostContext } from "./host.js";
import { isSessionId, sessionIdVariants } from "./ids.js";
import type { DshSessionHeader } from "./list-sessions.js";

export class DshDeleteError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface DshDeleteResult {
  stopped: boolean;
  flushed: boolean;
  detached: boolean;
  dirRemoved: boolean;
  projRemoved: boolean;
  workspaceRemoved: boolean;
  sidecarRemoved: boolean;
}

interface SessionPersistenceLike {
  listSnapshots(signal?: AbortSignal): Promise<Array<{ header: DshSessionHeader }>>;
  locate(meta: DshSessionHeader): { kind: string; path: string } | undefined;
}

interface LiveSessionLike {
  header?: DshSessionHeader;
}

interface SessionsServiceLike {
  get(id: string): LiveSessionLike | undefined;
  flush?(session: LiveSessionLike): Promise<void> | void;
  store?: { get(id: string): unknown; delete?(id: string): void };
  detachEntered?(entry: unknown): void;
  attachments?: { delete(session: unknown): void };
}

interface AgentLike {
  cancel?(cause: unknown): void;
  whenIdle?(): Promise<void>;
}

interface AgentsServiceLike {
  get(id: string): AgentLike | undefined;
}

interface KvTableLike {
  get(id: string): unknown;
  delete(id: string): Promise<void> | void;
  put?(id: string, value: unknown): Promise<void> | void;
  entries(): Iterable<[string, unknown]>;
}

interface StorageDomainLike {
  get(name: string):
    | {
        table?(name: string): KvTableLike;
        global?: { get(): unknown; set(value: unknown): Promise<void> | void };
      }
    | undefined;
}

export interface DshDeleteHooks {
  removePath?: (target: string) => Promise<{ ok: boolean; error?: string }>;
  existsDir?: (path: string) => boolean;
  wait?: (ms: number) => Promise<void>;
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

function sessionsRoot(): string {
  return join(dshHome(), "sessions");
}

function findSessionDirsByScan(sessionId: string): string[] {
  const root = sessionsRoot();
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
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
      } catch {
        // keep scanning
      }
    }
  }
  return found;
}

export async function locateSessionDirs(
  ctx: DshHostContext,
  sessionId: string,
): Promise<string[]> {
  const dirs = new Set<string>();
  const persistence = optionalService<SessionPersistenceLike>(ctx, "sessionPersistence");
  const sessions = optionalService<SessionsServiceLike>(ctx, "sessions");

  const headers: DshSessionHeader[] = [];
  for (const variant of sessionIdVariants(sessionId)) {
    const live = sessions?.get?.(variant);
    if (live?.header) {
      headers.push(live.header);
    }
  }

  if (persistence) {
    try {
      const snapshots = await persistence.listSnapshots();
      for (const snapshot of snapshots) {
        if (sessionIdVariants(sessionId).includes(String(snapshot.header.id))) {
          headers.push(snapshot.header);
        }
      }
    } catch {
      // Fall back to directory scan below.
    }

    for (const header of headers) {
      const location = persistence.locate(header);
      if (location?.path) {
        dirs.add(dirname(location.path));
      }
    }
  }

  for (const scanned of findSessionDirsByScan(sessionId)) {
    dirs.add(scanned);
  }

  return [...dirs];
}

function sidecarPaths(sessionId: string): string[] {
  const dir = join(dshHome(), "pi2dsh", "agent", "session-entries");
  return sessionIdVariants(sessionId).map((id) => {
    const safe = id.replace(/[^a-zA-Z0-9._-]+/gu, "_");
    return join(dir, `${safe}.jsonl`);
  });
}

async function stopAgentIfRunning(ctx: DshHostContext, sessionId: string): Promise<boolean> {
  const agents = optionalService<AgentsServiceLike>(ctx, "agents");
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
    } catch {
      // Agent may already be settling.
    }
    if (typeof agent.whenIdle === "function") {
      try {
        await Promise.race([
          agent.whenIdle(),
          new Promise<void>((resolve) => {
            setTimeout(resolve, 15_000).unref?.();
          }),
        ]);
      } catch {
        // Proceed with deletion.
      }
    }
  }
  return stopped;
}

async function flushSessionIfLive(ctx: DshHostContext, sessionId: string): Promise<boolean> {
  const sessions = optionalService<SessionsServiceLike>(ctx, "sessions");
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
    } catch {
      // Deletion still proceeds.
    }
  }
  return flushed;
}

function detachLiveSession(ctx: DshHostContext, sessionId: string): boolean {
  const sessions = optionalService<SessionsServiceLike>(ctx, "sessions");
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
  } catch {
    // Live detach is best-effort; disk cleanup still runs.
  }
  return detached;
}

async function trashTargets(
  targets: readonly string[],
  hooks: DshDeleteHooks,
): Promise<{ removed: boolean; error?: string }> {
  const sendToTrash = hooks.removePath ?? removeSessionArtifact;
  const exists = hooks.existsDir ?? existsSync;
  let removed = false;
  const errors: string[] = [];

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

async function stripStorageDomains(
  ctx: DshHostContext,
  sessionId: string,
  options: { workspace: boolean },
): Promise<{ projRemoved: boolean; workspaceRemoved: boolean }> {
  const storage = optionalService<StorageDomainLike>(ctx, "storageDomain");
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
    } catch {
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
        const sessionIds = (record as { sessionIds?: unknown }).sessionIds;
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
    } catch {
      // Unit closed or table absent.
    }

    try {
      const globalState = workspace.global;
      if (globalState && typeof globalState.get === "function" && typeof globalState.set === "function") {
        const state = globalState.get() as { archivedSessionIds?: unknown } | undefined;
        const archived = state?.archivedSessionIds;
        if (Array.isArray(archived) && archived.some((id) => variants.includes(String(id)))) {
          await globalState.set({
            ...state,
            archivedSessionIds: archived.filter((id) => !variants.includes(String(id))),
          });
          workspaceRemoved = true;
        }
      }
    } catch {
      // No global slot.
    }
  }

  return { projRemoved, workspaceRemoved };
}

async function trashSidecars(
  sessionId: string,
  hooks: DshDeleteHooks,
): Promise<boolean> {
  const exists = hooks.existsDir ?? existsSync;
  const present = sidecarPaths(sessionId).filter((sidecar) => exists(sidecar));
  if (present.length === 0) {
    return false;
  }
  const result = await trashTargets(present, hooks);
  return result.removed;
}

export async function deleteDshSession(
  ctx: DshHostContext,
  sessionId: string,
  hooks: DshDeleteHooks = {},
): Promise<DshDeleteResult> {
  const trimmed = sessionId.trim();
  if (!isSessionId(trimmed)) {
    throw new DshDeleteError(`invalid session id: ${sessionId}`, 400);
  }

  const stopped = await stopAgentIfRunning(ctx, trimmed);
  const flushed = await flushSessionIfLive(ctx, trimmed);
  const detached = detachLiveSession(ctx, trimmed);

  const wait = hooks.wait ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  }));
  const exists = hooks.existsDir ?? existsSync;

  let firstDirs = await locateSessionDirs(ctx, trimmed);
  const firstTrash = await trashTargets(firstDirs, hooks);

  const projOnly = await stripStorageDomains(ctx, trimmed, { workspace: false });
  const sidecarRemoved = await trashSidecars(trimmed, hooks);

  firstDirs = await locateSessionDirs(ctx, trimmed);
  const secondTrash = await trashTargets(firstDirs, hooks);
  await wait(0);
  firstDirs = await locateSessionDirs(ctx, trimmed);
  const thirdTrash = await trashTargets(firstDirs, hooks);

  const remaining = (await locateSessionDirs(ctx, trimmed)).filter((dir) => exists(dir));
  if (remaining.length > 0) {
    const trashError = thirdTrash.error ?? secondTrash.error ?? firstTrash.error;
    throw new DshDeleteError(
      `session files could not be removed: ${remaining.join(", ")}${trashError ? ` (${trashError})` : ""}`,
      500,
    );
  }

  const workspaceStorage = await stripStorageDomains(ctx, trimmed, { workspace: true });
  const dirRemoved = firstTrash.removed || secondTrash.removed || thirdTrash.removed;
  const projRemoved = projOnly.projRemoved || workspaceStorage.projRemoved;
  const workspaceRemoved = workspaceStorage.workspaceRemoved;

  if (!dirRemoved && !projRemoved && !workspaceRemoved && !sidecarRemoved && !detached) {
    throw new DshDeleteError(`session not found: ${trimmed}`, 404);
  }

  return {
    stopped,
    flushed,
    detached,
    dirRemoved,
    projRemoved,
    workspaceRemoved,
    sidecarRemoved,
  };
}

export function describeDeleteFailure(error: unknown): string {
  return getErrorMessage(error);
}
