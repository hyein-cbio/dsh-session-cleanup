import { statSync } from "node:fs";

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

export function isOrphanedSession(session: { cwd?: string | null }): boolean {
  const cwd = typeof session.cwd === "string" ? session.cwd.trim() : "";
  if (!cwd) {
    return true;
  }

  try {
    return !statSync(cwd).isDirectory();
  } catch (error) {
    return isNotFoundError(error);
  }
}
