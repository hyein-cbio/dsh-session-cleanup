export function commandResult(kind, text) {
    return { kind, text };
}
export function currentSessionId(invocation) {
    const id = invocation.agent?.session?.id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
}
export function currentCwd(invocation) {
    const headerCwd = invocation.agent?.session?.header?.cwd;
    if (typeof headerCwd === "string" && headerCwd.length > 0) {
        return headerCwd;
    }
    const optionCwd = invocation.agent?.options?.cwd;
    return typeof optionCwd === "string" && optionCwd.length > 0 ? optionCwd : undefined;
}
export function currentAgentPreset(invocation) {
    const preset = invocation.agent?.session?.header?.agentPreset;
    return typeof preset === "string" && preset.length > 0 ? preset : undefined;
}
