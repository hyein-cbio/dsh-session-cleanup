export interface DshCommandInvocation {
  agent?: {
    session?: { id?: unknown; header?: { cwd?: unknown; agentPreset?: unknown } };
    options?: { cwd?: unknown };
  };
  rawInput: string;
  signal?: AbortSignal;
}

export interface CommandResult {
  kind: "success" | "error";
  text?: string;
}

export function commandResult(kind: "success" | "error", text: string): CommandResult {
  return { kind, text };
}

export function currentSessionId(invocation: DshCommandInvocation): string | undefined {
  const id = invocation.agent?.session?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function currentCwd(invocation: DshCommandInvocation): string | undefined {
  const headerCwd = invocation.agent?.session?.header?.cwd;
  if (typeof headerCwd === "string" && headerCwd.length > 0) {
    return headerCwd;
  }
  const optionCwd = invocation.agent?.options?.cwd;
  return typeof optionCwd === "string" && optionCwd.length > 0 ? optionCwd : undefined;
}

export function currentAgentPreset(invocation: DshCommandInvocation): string | undefined {
  const preset = invocation.agent?.session?.header?.agentPreset;
  return typeof preset === "string" && preset.length > 0 ? preset : undefined;
}
