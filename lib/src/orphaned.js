import { statSync } from "node:fs";
function isNotFoundError(error) {
    return Boolean(error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT");
}
export function isOrphanedSession(session) {
    const cwd = typeof session.cwd === "string" ? session.cwd.trim() : "";
    if (!cwd) {
        return true;
    }
    try {
        return !statSync(cwd).isDirectory();
    }
    catch (error) {
        return isNotFoundError(error);
    }
}
