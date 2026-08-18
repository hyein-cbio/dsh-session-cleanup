const SESSION_ID_RE = /^(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value.trim());
}

/** DSH stores the same session as both `<uuid>` and `session-<uuid>`. */
export function sessionIdVariants(sessionId: string): string[] {
  const normalized = sessionId.trim();
  const variants = new Set<string>([normalized]);
  if (normalized.startsWith("session-")) {
    variants.add(normalized.slice("session-".length));
  } else if (SESSION_ID_RE.test(normalized)) {
    variants.add(`session-${normalized}`);
  }
  return [...variants];
}

export function idsMatch(left: string, right: string): boolean {
  const rightVariants = new Set(sessionIdVariants(right));
  return sessionIdVariants(left).some((id) => rightVariants.has(id));
}
