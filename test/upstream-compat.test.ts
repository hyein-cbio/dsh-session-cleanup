import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function classify(log: string) {
  const result = spawnSync(process.execPath, ["scripts/upstream-compat.mjs", "--classify"], {
    input: log,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test("a host version-gate refusal is INCOMPATIBLE and runs no integration assertions", () => {
  const classified = classify([
    "dsh: installation rejected: Plugin @deepseek-harness-tui/dsh-tui@0.17.0 is incompatible with dsh 0.2.2-alpha.2: requirements {\"@deepseek-ai/dsh-agent\":\"0.2.1-rc.3\"}.",
    "dsh: nothing was installed.",
  ].join("\n"));
  assert.equal(classified.status, 2);
  assert.match(classified.output, /result: INCOMPATIBLE/);
  assert.match(classified.output, /\[not run\] \/nix is registered and \/nix help works/);
  assert.doesNotMatch(classified.output, /result: VERIFIED/);
});

test("a network failure is BLOCKED rather than an incompatibility", () => {
  const classified = classify("npm error network ECONNRESET fetching https://registry.npmjs.org/example");
  assert.equal(classified.status, 3);
  assert.match(classified.output, /result: BLOCKED/);
  assert.doesNotMatch(classified.output, /result: INCOMPATIBLE/);
});

test("an accepted install without live TUI assertions is not VERIFIED", () => {
  const classified = classify("dsh: added @deepseek-harness-tui/dsh-tui");
  assert.equal(classified.status, 3);
  assert.match(classified.output, /result: BLOCKED/);
  assert.match(classified.output, /live TUI integration assertions have not run/);
});
