const SESSION_ID_RE = /^(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSessionId(value) {
    return SESSION_ID_RE.test(value.trim());
}
/** DSH stores the same session as both `<uuid>` and `session-<uuid>`. */
export function sessionIdVariants(sessionId) {
    const normalized = sessionId.trim();
    const variants = new Set([normalized]);
    if (normalized.startsWith("session-")) {
        variants.add(normalized.slice("session-".length));
    }
    else if (SESSION_ID_RE.test(normalized)) {
        variants.add(`session-${normalized}`);
    }
    return [...variants];
}
export function idsMatch(left, right) {
    const rightVariants = new Set(sessionIdVariants(right));
    return sessionIdVariants(left).some((id) => rightVariants.has(id));
}
