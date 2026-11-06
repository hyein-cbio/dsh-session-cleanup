import assert from "node:assert/strict";
import test from "node:test";

import * as entry from "../index.js";
import { apply, inject, name } from "../src/dsh/plugin.js";

test("package entry exports only the native DSH plugin", () => {
  assert.deepEqual(Object.keys(entry).sort(), ["apply", "inject", "name"]);
  assert.equal(entry.apply, apply);
  assert.equal(entry.name, "dsh-session-cleanup");
  assert.deepEqual(entry.inject, ["commands", "tuiScenes"]);
});

test("apply registers /nix and disposes command registration", async () => {
  assert.equal(name, "dsh-session-cleanup");
  assert.deepEqual(inject, ["commands", "tuiScenes"]);

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

  assert.deepEqual(registered, ["nix"]);
  const nixHelp = await handlers.get("nix")!({ rawInput: "help" });
  assert.match(nixHelp.text ?? "", /Usage: \/nix/);
  assert.doesNotMatch(nixHelp.text ?? "", /session-cleanup/);

  effectCleanup?.();
  assert.equal(disposed, 1);
});

test("apply throws when the host has no command registry", () => {
  assert.throws(
    () => apply({ get: () => undefined }),
    /requires ctx.commands/,
  );
});
