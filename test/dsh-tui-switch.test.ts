import assert from "node:assert/strict";
import test from "node:test";

import {
  NIX_SWITCH_SCENE_ID,
  registerNixCommandTree,
  registerNixSwitchScene,
  switchToNewSession,
} from "../src/dsh/tui-switch.js";

const oldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("switchToNewSession opens the registered scene and reports the previous id", async () => {
  let registeredId: string | undefined;
  let openedId: string | undefined;
  let closed = false;
  let scene: { component: (props: unknown) => unknown } | undefined;

  const ctx = {
    get(name: string) {
      if (name !== "tuiScenes") {
        return undefined;
      }
      return {
        register(descriptor: { id: string; component: (props: unknown) => unknown }) {
          registeredId = descriptor.id;
          scene = descriptor;
          return () => undefined;
        },
        open(id: string) {
          openedId = id;
          const props = {
            React: {
              useEffect(effect: () => void | (() => void)) {
                effect();
              },
              createElement: () => null,
            },
            channel: {
              agentId: oldId,
              newSession: async () => true,
            },
            close() {
              closed = true;
            },
          };
          scene?.component(props);
          return true;
        },
      };
    },
  };

  const dispose = registerNixSwitchScene(ctx);
  const result = await switchToNewSession(ctx);
  dispose();

  assert.equal(registeredId, NIX_SWITCH_SCENE_ID);
  assert.equal(openedId, NIX_SWITCH_SCENE_ID);
  assert.equal(result.ok, true);
  assert.equal(result.previousSessionId, oldId);
  assert.equal(closed, true);
});

test("switchToNewSession errors when dsh-tui scenes are missing", async () => {
  const result = await switchToNewSession({ get: () => undefined });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /needs dsh-tui/);
});

test("scene registration uses the command context as owner and releases it", () => {
  let identity: unknown;
  let disposed = false;
  const ctx = {
    get(name: string) {
      return name === "tuiScenes" ? {
        register(_descriptor: unknown, owner: unknown) {
          identity = owner;
          return () => { disposed = true; };
        },
      } : undefined;
    },
  };
  const dispose = registerNixSwitchScene(ctx);
  assert.equal(identity, ctx);
  assert.equal(disposed, false);
  dispose();
  assert.equal(disposed, true);
});

test("switchToNewSession explains a refused scene without starting a session", async () => {
  const result = await switchToNewSession({
    get: () => ({ open: () => false }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.previousSessionId, "");
  assert.match(result.error ?? "", /missing or owned by another activation/);
});

test("registerNixCommandTree advertises quit and help", () => {
  let provider: { children(path: readonly string[]): ReadonlyArray<{ name: string }> } | undefined;
  registerNixCommandTree({
    get(name: string) {
      if (name !== "tuiCommandTrees") {
        return undefined;
      }
      return {
        register(next: { children(path: readonly string[]): ReadonlyArray<{ name: string }> }) {
          provider = next;
          return () => undefined;
        },
      };
    },
  });
  assert.deepEqual(
    provider?.children(["nix"]).map((child) => child.name),
    ["quit", "help"],
  );
});
