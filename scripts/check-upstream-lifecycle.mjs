#!/usr/bin/env node
/** Real Cordis/TUI ownership and reload checks; no renderer or session deletion.
 * Run after source-building the TUI:
 * DSH_COMPAT_TUI_ROOT=/path/to/tui node scripts/check-upstream-lifecycle.mjs
 * The commands registry is a small fixture; Cordis and TuiSceneRuntime are real.
 * The PTY suite separately verifies the actual host, commands, and renderer.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { pathToFileURL } from "node:url";

if (!process.env.DSH_COMPAT_TUI_ROOT) {
  throw new Error("DSH_COMPAT_TUI_ROOT must name a source-built TUI checkout");
}
const tui = resolve(process.env.DSH_COMPAT_TUI_ROOT);
const requireTui = createRequire(resolve(tui, "package.json"));
const { Context } = await import(pathToFileURL(requireTui.resolve("@deepseek-ai/cordis")));
// Test-only source-build paths, not a production dependency on TUI internals.
const { TuiSceneRuntime, getHostSceneRuntime } = await import(
  pathToFileURL(resolve(tui, "lib/types/dsh-adapter/scenes.js"))
);
const { deferRootCapabilityGuard } = await import(
  pathToFileURL(resolve(tui, "lib/types/dsh-adapter/host-access.js"))
);
const plugin = await import(pathToFileURL(resolve(
  process.env.DSH_COMPAT_PLUGIN_ENTRY ?? "lib/dsh-entry.js",
)));
const sceneId = "dsh-nix-switch";

async function settled(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Cordis lifecycle did not settle");
    await setImmediate();
  }
}

for (const late of [false, true]) {
  const root = new Context();
  const releaseGuard = deferRootCapabilityGuard(root);
  const commands = new Map();
  let owner;
  let registrations = 0;
  let disposals = 0;
  try {
    let foreignOwner;
    await root.plugin({ name: "foreign-scene-owner-fixture", apply(ctx) {
      foreignOwner = ctx;
    } });
    await root.plugin({ name: "lifecycle-commands-fixture", apply(ctx) {
      ctx.provide("commands", { register(definition) {
        assert.equal(commands.has(definition.name), false, "duplicate command registration");
        commands.set(definition.name, definition);
        registrations += 1;
        let disposed = false;
        return () => {
          if (disposed) return;
          disposed = true;
          commands.delete(definition.name);
          disposals += 1;
        };
      } });
    } });
    let sceneFiber;
    if (!late) sceneFiber = await root.plugin(TuiSceneRuntime);
    const cleanupFiber = root.plugin({ ...plugin, apply(ctx) {
      owner = ctx;
      return plugin.apply(ctx);
    } });
    if (late) {
      await setImmediate();
      assert.equal(owner, undefined, "plugin must wait for tuiScenes, not spawn a child activation");
      assert.equal(commands.size, 0);
      sceneFiber = await root.plugin(TuiSceneRuntime);
    }
    await cleanupFiber;

    function assertSceneAndCommand() {
      const host = getHostSceneRuntime(root.get("tuiScenes"));
      assert.deepEqual(host.list().map(scene => scene.id), [sceneId]);
      assert.equal(foreignOwner.get("tuiScenes").open(sceneId), false,
        "another activation must not open the cleanup plugin's scene");
      assert.equal(host.active, undefined, "refused foreign open must leave the scene inactive");
      // This was false on the broken delayed-injection path despite a listed scene.
      assert.equal(owner.get("tuiScenes").open(sceneId), true, "command owner must own its scene");
      assert.equal(host.active?.id, sceneId);
      host.close();
      assert.equal(commands.size, 1);
      return host;
    }

    const firstHost = assertSceneAndCommand();
    assert.match((await commands.get("nix").handler({ rawInput: "help" })).text, /Usage: \/nix/);
    await sceneFiber.dispose();
    await settled(() => commands.size === 0);
    assert.deepEqual(firstHost.list(), [], "service removal must release the old scene");
    assert.equal(disposals, 1);

    sceneFiber = await root.plugin(TuiSceneRuntime);
    await settled(() => commands.size === 1);
    const nextHost = assertSceneAndCommand();
    assert.equal(registrations, 2);
    await cleanupFiber.dispose();
    assert.equal(commands.size, 0);
    assert.deepEqual(nextHost.list(), [], "plugin disposal must release its scene");
    assert.equal(disposals, 2);
    console.log(`LIFECYCLE_OK ${late ? "late" : "early"} TUI; owner, foreign refusal, removal, reload, disposal`);
  } finally {
    releaseGuard();
    await root.fiber.dispose();
  }
}
