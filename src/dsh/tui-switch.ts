import { optionalService, type DshHostContext } from "./host.js";

export const NIX_SWITCH_SCENE_ID = "dsh-nix-switch";

export interface TuiSwitchResult {
  ok: boolean;
  previousSessionId: string;
  error?: string;
}

interface TuiChannelLike {
  agentId?: unknown;
  newSession(): Promise<boolean>;
}

interface NixSceneReact {
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  createElement: (...args: unknown[]) => unknown;
  Fragment?: unknown;
}

interface NixSceneProps {
  React: NixSceneReact;
  channel: TuiChannelLike;
  close(): void;
}

interface TuiScenesLike {
  register(descriptor: {
    id: string;
    title?: string;
    component: (props: NixSceneProps) => unknown;
  }, identity?: unknown): () => void;
  open(id: string): boolean;
}

interface TuiCommandTreesLike {
  register(provider: {
    root: string;
    children(canonicalPath: readonly string[]): ReadonlyArray<{ name: string; description: string }>;
  }): () => void;
}

type NixSwitchJob = {
  run(channel: TuiChannelLike, close: () => void): Promise<void>;
  cancel(reason: string): void;
};

type SwitchState = {
  pending?: NixSwitchJob;
  running?: NixSwitchJob;
};

// Never share pending work between different Cordis activations.
const switchStates = new WeakMap<DshHostContext, SwitchState>();

export function registerNixSwitchScene(ctx: DshHostContext): () => void {
  const state: SwitchState = {};
  switchStates.set(ctx, state);
  const scenes = optionalService<TuiScenesLike>(ctx, "tuiScenes");
  // plugin.inject guarantees readiness. Register under the command's owner,
  // not in a delayed ctx.inject child activation.
  const dispose = scenes && typeof scenes.register === "function"
    ? scenes.register({
        id: NIX_SWITCH_SCENE_ID,
        title: "nix",
        component({ React, channel, close }) {
          React.useEffect(() => {
            const job = state.pending;
            state.pending = undefined;
            if (job) void job.run(channel, close);
            else close();
            return () => job?.cancel("The nix switch scene was closed; no session was deleted.");
          }, []);
          return null;
        },
      }, ctx)
    : undefined;

  return () => {
    state.pending?.cancel("The nix plugin was disposed; no session was deleted.");
    state.running?.cancel("The nix plugin was disposed; no session was deleted.");
    if (switchStates.get(ctx) === state) switchStates.delete(ctx);
    dispose?.();
  };
}

export function registerNixCommandTree(ctx: DshHostContext): () => void {
  const trees = optionalService<TuiCommandTreesLike>(ctx, "tuiCommandTrees");
  if (!trees || typeof trees.register !== "function") return () => undefined;
  return trees.register({
    root: "nix",
    children(canonicalPath) {
      if (canonicalPath.length !== 1) return [];
      return [
        { name: "quit", description: "Delete the current session and exit DSH" },
        { name: "help", description: "Show /nix usage" },
      ];
    },
  });
}

export function hasPendingNixSwitch(ctx: DshHostContext): boolean {
  const state = switchStates.get(ctx);
  return Boolean(state?.pending || state?.running);
}

export async function switchToNewSession(
  ctx: DshHostContext,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TuiSwitchResult> {
  const failure = (error: string): TuiSwitchResult => ({ ok: false, previousSessionId: "", error });
  const scenes = optionalService<TuiScenesLike>(ctx, "tuiScenes");
  if (!scenes || typeof scenes.open !== "function") {
    return failure("/nix needs dsh-tui to switch the live view. Use /nix quit to delete this session and exit.");
  }
  if (options.signal?.aborted) return failure("Session switch cancelled; no session was deleted.");
  const state = switchStates.get(ctx) ?? {};
  switchStates.set(ctx, state);
  if (state.pending || state.running) {
    return failure("A previous nix switch is still settling; no session was deleted.");
  }

  return await new Promise((resolve) => {
    let settled = false;
    let closeScene: (() => void) | undefined;
    const finish = (result: TuiSwitchResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (state.pending === job) state.pending = undefined;
      // Keep running locked until the upstream promise actually settles.
      // The host has no cancellation API: a late adoption may still occur,
      // but it must never authorize deletion or race a second nix operation.
      try { closeScene?.(); } catch { /* The renderer may already be gone. */ }
      resolve(result);
    };
    const job: NixSwitchJob = {
      cancel: (reason) => finish(failure(reason)),
      async run(channel, close) {
        if (settled) return;
        closeScene = close;
        state.running = job;
        const previousSessionId = typeof channel.agentId === "string" ? channel.agentId : "";
        try {
          const ok = await channel.newSession();
          finish({ ok, previousSessionId,
            ...(ok ? {} : { error: "dsh-tui refused to start a new session (it may be working)." }),
          });
        } catch (error) {
          finish(failure(error instanceof Error ? error.message : String(error)));
        } finally {
          if (state.running === job) state.running = undefined;
        }
      },
    };
    const abort = (): void => job.cancel("Session switch cancelled; no session was deleted. A late host switch may still complete.");
    const timer = setTimeout(() => job.cancel(
      "Timed out waiting for dsh-tui to switch sessions; no session was deleted. A late host switch may still complete.",
    ), options.timeoutMs ?? 8_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    state.pending = job;
    try {
      if (!scenes.open(NIX_SWITCH_SCENE_ID)) {
        job.cancel("dsh-tui could not open the nix switch scene (missing or owned by another activation).");
      }
    } catch (error) {
      job.cancel(error instanceof Error ? error.message : String(error));
    }
  });
}
