import { optionalService } from "./host.js";
export const NIX_SWITCH_SCENE_ID = "dsh-nix-switch";
let pendingJob;
function nixSwitchScene(props) {
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
            }
            finally {
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
export function registerNixSwitchScene(ctx) {
    const disposers = [];
    const tryRegister = (scenes, identity) => {
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
    const existing = optionalService(ctx, "tuiScenes");
    if (existing) {
        tryRegister(existing, ctx);
    }
    else if (typeof ctx.inject === "function") {
        ctx.inject(["tuiScenes"], (sub) => {
            const scenes = sub.tuiScenes ?? (typeof sub.get === "function" ? sub.get("tuiScenes") : undefined);
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
export function registerNixCommandTree(ctx) {
    const trees = optionalService(ctx, "tuiCommandTrees");
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
export async function switchToNewSession(ctx, options = {}) {
    const scenes = optionalService(ctx, "tuiScenes");
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
        const job = {
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
                }
                catch (error) {
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
