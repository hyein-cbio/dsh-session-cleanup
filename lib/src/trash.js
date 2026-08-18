import { spawn } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
const TRASH_PROVIDER_TIMEOUT_MS = 5_000;
const TRASH_PROVIDER_MAX_STDERR_BYTES = 64 * 1024;
function argsWithDashSafety(prefix, targetPath, suffix = []) {
    const pathArgs = targetPath.startsWith("-") ? ["--", targetPath] : [targetPath];
    return [...prefix, ...pathArgs, ...suffix];
}
const TRASH_PROVIDERS = [
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
function buildTrashErrorHint(providerName, result) {
    const details = [];
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
export function runTrashProcess(command, args, options) {
    return new Promise((resolve) => {
        const allowedTrashCommands = new Set(TRASH_PROVIDERS.map((provider) => provider.command));
        if (!allowedTrashCommands.has(command)) {
            resolve({
                status: null,
                error: new Error(`Trash command is not allowlisted: ${command}`),
            });
            return;
        }
        let child;
        try {
            child = spawn(command, [...args], {
                stdio: ["ignore", "ignore", "pipe"],
                windowsHide: true,
            });
        }
        catch (error) {
            resolve({
                status: null,
                error: error instanceof Error ? error : new Error(String(error)),
            });
            return;
        }
        const stderrChunks = [];
        let stderrBytes = 0;
        let processError;
        let settled = false;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve(result);
        };
        const failAndKill = (error) => {
            if (!processError) {
                processError = error;
            }
            child.kill();
        };
        const timeout = setTimeout(() => {
            failAndKill(new Error(`Trash provider timed out after ${options.timeout}ms.`));
        }, options.timeout);
        timeout.unref?.();
        child.stderr?.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            stderrBytes += buffer.length;
            if (stderrBytes > options.maxStderrBytes) {
                failAndKill(new Error(`Trash provider stderr exceeded ${options.maxStderrBytes} bytes.`));
                return;
            }
            stderrChunks.push(buffer);
        });
        child.on("error", (error) => {
            processError = error;
            finish({
                status: null,
                stderr: Buffer.concat(stderrChunks).toString("utf8"),
                error: processError,
            });
        });
        child.on("close", (status) => {
            finish({
                status,
                stderr: Buffer.concat(stderrChunks).toString("utf8"),
                error: processError,
            });
        });
    });
}
export function resolveUserTrashDir() {
    if (process.env.DSH_SESSION_TRASH_DIR) {
        return process.env.DSH_SESSION_TRASH_DIR;
    }
    return process.platform === "darwin"
        ? join(homedir(), ".Trash")
        : join(homedir(), ".local", "share", "Trash", "files");
}
export function moveToUserTrash(targetPath) {
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
    }
    catch {
        return false;
    }
}
/** Move a file or directory to the desktop trash. Never unlinks or rm -rf. */
export async function trashPath(targetPath, options = {}) {
    const runProcess = options.spawn ?? runTrashProcess;
    const pathExists = options.existsSync ?? existsSync;
    const moveTrash = options.moveToUserTrash ?? moveToUserTrash;
    const hints = [];
    if (!pathExists(targetPath)) {
        return { ok: true };
    }
    for (const provider of TRASH_PROVIDERS) {
        const result = await runProcess(provider.command, provider.getArgs(targetPath), {
            timeout: TRASH_PROVIDER_TIMEOUT_MS,
            maxStderrBytes: TRASH_PROVIDER_MAX_STDERR_BYTES,
        });
        if (result.status === 0 || !pathExists(targetPath)) {
            return { ok: true };
        }
        const hint = buildTrashErrorHint(provider.name, result);
        if (hint) {
            hints.push(hint);
        }
    }
    if (moveTrash(targetPath) && !pathExists(targetPath)) {
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
export async function removeSessionArtifact(targetPath, options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform === "darwin") {
        return trashPath(targetPath, options);
    }
    const pathExists = options.existsSync ?? existsSync;
    if (!pathExists(targetPath)) {
        return { ok: true };
    }
    try {
        const rm = options.rm ?? ((target) => {
            rmSync(target, { recursive: true, force: true });
        });
        rm(targetPath);
        return { ok: true };
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
