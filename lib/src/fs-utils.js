import { lstatSync } from "node:fs";
/** Unlike existsSync, access/I/O errors must not masquerade as absence. */
export function pathExists(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch (error) {
        if (isMissingPath(error)) {
            return false;
        }
        throw error;
    }
}
export function isMissingPath(error) {
    return typeof error === "object" && error !== null
        && "code" in error && error.code === "ENOENT";
}
