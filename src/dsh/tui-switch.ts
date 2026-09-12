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
  run(channel: TuiChannelLike): Promise<void>;
};

let pendingJob: NixSwitchJob | undefined;

function nixSwitchScene(props: NixSceneProps): unknown {
  const { React, channel, close } = props;
  React.useEffect(() => {
    const job = pendingJob;
    pendingJob = undefined;
    let cancelled = false;
    void (async () => {
      try {
        if (job) {
          await job.run(channel);
        }
      } finally {
        if (!cancelled) {
          close();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

interface TuiSwitchHostContext extends DshHostContext {
  effect?(fn: () => () => void): void;
  inject?(deps: string[], callback: (sub: TuiScenesHost) => void): unknown;
}

interface TuiScenesHost {
  tuiScenes?: TuiScenesLike;
  get?(name: string): unknown;
}

export function registerNixSwitchScene(ctx: TuiSwitchHostContext): () => void {
  const disposers: Array<() => void> = [];

  const tryRegister = (scenes: TuiScenesLike | undefined, identity?: unknown): void => {
    if (!scenes || typeof scenes.register !== "function") {
      return;
    }
    const dispose = scenes.register({
      id: NIX_SWITCH_SCENE_ID,
      title: "nix",
      component: nixSwitchScene,
    }, identity);
    if (typeof dispose === "function") {
      disposers.push(dispose);
    }
  };

  const existing = optionalService<TuiScenesLike>(ctx, "tuiScenes");
  if (existing) {
    tryRegister(existing, ctx);
  } else if (typeof ctx.inject === "function") {
    ctx.inject(["tuiScenes"], (sub) => {
      const scenes = sub.tuiScenes ?? (typeof sub.get === "function" ? sub.get("tuiScenes") as TuiScenesLike : undefined);
      tryRegister(scenes, sub);
    });
  }

  return () => {
    pendingJob = undefined;
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export function registerNixCommandTree(ctx: DshHostContext): () => void {
  const trees = optionalService<TuiCommandTreesLike>(ctx, "tuiCommandTrees");
  if (!trees || typeof trees.register !== "function") {
    return () => undefined;
  }
  return trees.register({
    root: "nix",
    children(canonicalPath) {
      if (canonicalPath.length !== 1) {
        return [];
      }
      return [
        { name: "quit", description: "Delete the current session and exit DSH" },
        { name: "help", description: "Show /nix usage" },
      ];
    },
  });
}

export async function switchToNewSession(
  ctx: DshHostContext,
  options: { timeoutMs?: number } = {},
): Promise<TuiSwitchResult> {
  const scenes = optionalService<TuiScenesLike>(ctx, "tuiScenes");
  if (!scenes || typeof scenes.open !== "function") {
    return {
      ok: false,
      previousSessionId: "",
      error: "/nix needs dsh-tui to switch the live view. Use /nix quit to delete this session and exit.",
    };
  }

  const timeoutMs = options.timeoutMs ?? 8_000;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingJob === job) {
        pendingJob = undefined;
      }
      resolve({
        ok: false,
        previousSessionId: "",
        error: "Timed out waiting for dsh-tui to switch sessions.",
      });
    }, timeoutMs);
    timer.unref?.();

    const job: NixSwitchJob = {
      async run(channel) {
        clearTimeout(timer);
        const previousSessionId = typeof channel.agentId === "string" ? channel.agentId : "";
        try {
          const ok = await channel.newSession();
          resolve({
            ok,
            previousSessionId,
            ...(ok ? {} : { error: "dsh-tui refused to start a new session (it may be working)." }),
          });
        } catch (error) {
          resolve({
            ok: false,
            previousSessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };

    pendingJob = job;
    const opened = scenes.open(NIX_SWITCH_SCENE_ID);
    if (!opened) {
      pendingJob = undefined;
      clearTimeout(timer);
      resolve({
        ok: false,
        previousSessionId: "",
        error: "dsh-tui has no nix switch scene registered.",
      });
    }
  });
}
