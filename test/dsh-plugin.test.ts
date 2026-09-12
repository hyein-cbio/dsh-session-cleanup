import assert from "node:assert/strict";
import test from "node:test";

import sessionCleanupExtension from "../src/index.js";
import { apply, dshPluginApplied, inject, name } from "../src/dsh/plugin.js";

test("apply registers /nix and disposes the applied flag", async () => {
  assert.equal(name, "dsh-session-cleanup");
  assert.deepEqual(inject, ["commands"]);

  const registered: string[] = [];
  const handlers = new Map<string, (invocation: { rawInput: string }) => Promise<{ kind: string; text?: string }>>();
  let disposed = 0;
  let effectCleanup: (() => void) | undefined;

  apply({
    get(service: string) {
      if (service === "commands") {
        return {
          register(definition: { name: string; handler: (invocation: { rawInput: string }) => Promise<{ kind: string; text?: string }> }) {
            registered.push(definition.name);
            handlers.set(definition.name, definition.handler);
            return () => {
              disposed += 1;
            };
          },
        };
      }
      return undefined;
    },
    effect(fn: () => () => void) {
      effectCleanup = fn();
    },
  });

  assert.equal(dshPluginApplied(), true);
  assert.deepEqual(registered, ["nix"]);
  const nixHelp = await handlers.get("nix")!({ rawInput: "help" });
  assert.match(nixHelp.text ?? "", /Usage: \/nix/);
  assert.doesNotMatch(nixHelp.text ?? "", /session-cleanup/);

  effectCleanup?.();
  assert.equal(disposed, 1);
  assert.equal(dshPluginApplied(), false);
});

test("apply throws when the host has no command registry", () => {
  assert.throws(
    () => apply({ get: () => undefined }),
    /requires ctx.commands/,
  );
});

test("Pi extension skips command registration after the DSH plugin is applied", () => {
  const commands: string[] = [];
  let reset: (() => void) | undefined;
  apply({
    commands: {
      register(definition) {
        commands.push(`dsh:${definition.name}`);
        return () => undefined;
      },
    },
    get: () => undefined,
    effect(fn) {
      reset = fn();
    },
  });

  try {
    sessionCleanupExtension({
      registerCommand(name: string) {
        commands.push(`pi:${name}`);
      },
      on() {
        return undefined;
      },
    } as never);

    assert.deepEqual(commands, ["dsh:nix"]);
  } finally {
    reset?.();
    assert.equal(dshPluginApplied(), false);
  }
});
