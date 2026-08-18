import { unlink } from "node:fs/promises";

import type { DeleteSessionResult } from "./types.js";
import { getErrorMessage } from "./error-utils.js";
import { trashPath, type TrashPathOptions } from "./trash.js";

export interface DeleteSessionFileOptions extends TrashPathOptions {
  unlink?: (path: string) => Promise<void>;
}

function isDshArtifactPath(sessionPath: string): boolean {
  if (sessionPath.endsWith(".jsonl.zstd")) {
    return true;
  }
  const normalized = sessionPath.replace(/\\/g, "/");
  return normalized.includes("/sessions/") && normalized.endsWith("/session.jsonl");
}

/**
 * Mirrors Pi's built-in behavior: try moving to trash first, then fallback to unlink.
 * DSH session artifacts are refused here — those go through the host trash chain.
 */
export async function deleteSessionFile(
  sessionPath: string,
  options: DeleteSessionFileOptions = {},
): Promise<DeleteSessionResult> {
  if (isDshArtifactPath(sessionPath)) {
    return {
      ok: false,
      method: "unlink",
      error:
        "Refused to trash/unlink a DSH session artifact. Use /session-cleanup on the DSH host plugin, which sends the session directory to trash and then clears projection cache and workspace accounting.",
    };
  }

  const trash = await trashPath(sessionPath, options);
  if (trash.ok) {
    return { ok: true, method: "trash" };
  }

  const unlinkFile = options.unlink ?? unlink;
  try {
    await unlinkFile(sessionPath);
    return { ok: true, method: "unlink" };
  } catch (error) {
    const unlinkError = getErrorMessage(error);
    return {
      ok: false,
      method: "unlink",
      error: trash.error ? `${unlinkError} (${trash.error})` : unlinkError,
    };
  }
}
