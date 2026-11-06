import { spawn } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { pathExists } from "./fs-utils.js";

const TRASH_PROVIDER_TIMEOUT_MS = 5_000;
const TRASH_PROVIDER_MAX_STDERR_BYTES = 64 * 1024;

interface TrashProcessResult {
  status: number | null;
  stderr?: string;
  error?: Error;
  unsafeToRetry?: boolean;
}

export type TrashProcessRunner = (
  command: string,
  args: readonly string[],
  options: { timeout: number; maxStderrBytes: number },
) => Promise<TrashProcessResult>;

interface TrashProvider {
  name: string;
  command: string;
  getArgs: (targetPath: string) => string[];
}

export interface TrashPathOptions {
  spawn?: TrashProcessRunner;
  existsSync?: (path: string) => boolean;
  moveToUserTrash?: (targetPath: string) => boolean;
  platform?: NodeJS.Platform;
  rm?: (targetPath: string) => void;
}

export interface TrashPathResult {
  ok: boolean;
  error?: string;
  retryable?: boolean;
}

function argsWithDashSafety(prefix: string[], targetPath: string, suffix: string[] = []): string[] {
  const pathArgs = targetPath.startsWith("-") ? ["--", targetPath] : [targetPath];
  return [...prefix, ...pathArgs, ...suffix];
}

const TRASH_PROVIDERS: readonly TrashProvider[] = [
  {
    name: "trash",
    command: "trash",
    getArgs: (targetPath) => argsWithDashSafety([], targetPath),
  },
  {
    name: "trash-put",
    command: "trash-put",
    getArgs: (targetPath) => argsWithDashSafety([], targetPath),
  },
  {
    name: "gio trash",
    command: "gio",
    getArgs: (targetPath) => argsWithDashSafety(["trash"], targetPath),
  },
  {
    name: "kioclient5 move",
    command: "kioclient5",
    getArgs: (targetPath) => argsWithDashSafety(["move"], targetPath, ["trash:/"]),
  },
  {
    name: "kioclient move",
    command: "kioclient",
    getArgs: (targetPath) => argsWithDashSafety(["move"], targetPath, ["trash:/"]),
  },
  {
    name: "finder",
    command: "osascript",
    getArgs: (targetPath) => [
      "-e",
      `tell application "Finder" to delete POSIX file ${JSON.stringify(targetPath)}`,
    ],
  },
];

function buildTrashErrorHint(providerName: string, result: TrashProcessResult): string | null {
  const details: string[] = [];

  if (result.error) {
    details.push(result.error.message);
  }

  const stderr = result.stderr?.trim();
  if (stderr) {
    details.push(stderr.split("\n")[0] ?? stderr);
  }

  if (details.length === 0) {
    return null;
  }

  return `${providerName}: ${details.join(" · ").slice(0, 200)}`;
}

export function runTrashProcess(
  command: string,
  args: readonly string[],
  options: { timeout: number; maxStderrBytes: number },
): Promise<TrashProcessResult> {
  return new Promise((resolve) => {
    const allowedTrashCommands = new Set(TRASH_PROVIDERS.map((provider) => provider.command));
    if (!allowedTrashCommands.has(command)) {
      resolve({
        status: null,
        error: new Error(`Trash command is not allowlisted: ${command}`),
      });
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- command is checked against the hardcoded TRASH_PROVIDERS command list above; args are provider-generated arrays and shell is disabled.
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        // Own a process group so helpers cannot keep stderr (or deletion) alive.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve({
        status: null,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }

    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let processError: Error | undefined;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: TrashProcessResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
      resolve(result);
    };

    const signalProvider = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== "win32" && child.pid !== undefined) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // It may already have exited; close will confirm that below.
      }
    };

    const failAndKill = (error: Error): void => {
      if (settled || killTimer !== undefined) return;
      processError ??= error;
      signalProvider("SIGTERM");
      killTimer = setTimeout(() => {
        signalProvider("SIGKILL");
        drainTimer = setTimeout(() => {
          // Do not try another deletion provider while termination is unknown.
          child.stderr?.destroy();
          child.unref();
          finish({ status: null, error: processError, unsafeToRetry: true });
        }, 250);
      }, 250);
    };

    const timeout = setTimeout(() => {
      failAndKill(new Error(`Trash provider timed out after ${options.timeout}ms.`));
    }, options.timeout);
    timeout.unref?.();

    child.stderr?.on("data", (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stderrBytes += buffer.length;
      if (stderrBytes > options.maxStderrBytes) {
        failAndKill(new Error(`Trash provider stderr exceeded ${options.maxStderrBytes} bytes.`));
        return;
      }

      stderrChunks.push(buffer);
    });

    child.on("error", (error: Error) => {
      processError = error;
      finish({
        status: null,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        error: processError,
      });
    });

    child.on("close", (status: number | null) => {
      finish({
        status,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        error: processError,
      });
    });
  });
}

export function resolveUserTrashDir(): string {
  if (process.env.DSH_SESSION_TRASH_DIR) {
    return process.env.DSH_SESSION_TRASH_DIR;
  }
  return process.platform === "darwin"
    ? join(homedir(), ".Trash")
    : join(homedir(), ".local", "share", "Trash", "files");
}

export function moveToUserTrash(targetPath: string): boolean {
  const trashDir = resolveUserTrashDir();
  if (!existsSync(trashDir)) {
    return false;
  }

  const base = basename(targetPath) || "session";
  let destination = join(trashDir, base);
  let suffix = 1;
  while (existsSync(destination)) {
    destination = join(trashDir, `${base} ${suffix}`);
    suffix += 1;
  }

  try {
    renameSync(targetPath, destination);
    return !existsSync(targetPath);
  } catch {
    return false;
  }
}

/** Move a file or directory to the desktop trash. Never unlinks or rm -rf. */
export async function trashPath(
  targetPath: string,
  options: TrashPathOptions = {},
): Promise<TrashPathResult> {
  try {
    return await trashPathChecked(targetPath, options);
  } catch (error) {
    return { ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function trashPathChecked(targetPath: string, options: TrashPathOptions): Promise<TrashPathResult> {
  const runProcess = options.spawn ?? runTrashProcess;
  const targetExists = options.existsSync ?? pathExists;
  const moveTrash = options.moveToUserTrash ?? moveToUserTrash;
  const hints: string[] = [];

  if (!targetExists(targetPath)) {
    return { ok: true };
  }

  for (const provider of TRASH_PROVIDERS) {
    const result = await runProcess(provider.command, provider.getArgs(targetPath), {
      timeout: TRASH_PROVIDER_TIMEOUT_MS,
      maxStderrBytes: TRASH_PROVIDER_MAX_STDERR_BYTES,
    });

    if (result.unsafeToRetry) {
      return { ok: false, retryable: false, error: "Trash provider termination could not be confirmed; no fallback was attempted." };
    }
    if (!targetExists(targetPath)) {
      return { ok: true };
    }

    const hint = buildTrashErrorHint(provider.name, result);
    if (hint) {
      hints.push(hint);
    }
  }

  if (moveTrash(targetPath) && !targetExists(targetPath)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: hints.length > 0
      ? `Could not move to trash (${hints.join("; ")})`
      : "Could not move to trash.",
  };
}

/**
 * macOS: send the file or directory to Trash.
 * Other platforms: permanently remove it with rm -rf.
 */
export async function removeSessionArtifact(
  targetPath: string,
  options: TrashPathOptions = {},
): Promise<TrashPathResult> {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return trashPath(targetPath, options);
  }

  const targetExists = options.existsSync ?? pathExists;
  try {
    if (!targetExists(targetPath)) {
      return { ok: true };
    }
    const rm = options.rm ?? ((target: string) => {
      rmSync(target, { recursive: true, force: true });
    });
    rm(targetPath);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
