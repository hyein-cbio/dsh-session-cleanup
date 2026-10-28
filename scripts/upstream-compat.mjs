#!/usr/bin/env node
/**
 * Official local-source composition check for one Harness + dsh-TUI pair.
 *
 * The dsh on PATH must be the selected Harness source build. This script
 * asks that dsh to install the selected dsh-TUI checkout into an isolated
 * profile. It never grants a version exemption and never installs either
 * upstream from a registry.
 *
 * Exit status:
 *   2  INCOMPATIBLE — the host rejected the TUI manifest
 *   3  BLOCKED — the composition did not yield a verdict, or it was accepted
 *      but the live TUI integration assertions have not run
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED_INTEGRATION = [
  "packed plugin loads into the isolated dsh-TUI/DSH composition",
  "/nix is registered and /nix help works",
  "cancelling confirmation preserves the original session",
  "confirmed /nix adopts a different live session before removing the old directory",
  "the new session remains usable after the switch",
  "old session directory, projection cache, and workspace references are removed",
  "/nix quit exits without recreating the deleted session",
  "restarting the isolated host does not resurrect the deleted session",
  "an unrelated control session remains untouched",
  "missing TUI switch capability refuses /nix without deleting the session",
];

export function classifyComposition(log) {
  const text = String(log ?? "");
  const rejected = /installation rejected:/i.test(text)
    && /incompatible with dsh /i.test(text)
    && /nothing was installed/i.test(text);
  if (rejected) {
    return {
      result: "INCOMPATIBLE",
      exitCode: 2,
      integrationRan: [],
      reason: "The running dsh rejected the dsh-TUI checkout before installation.",
    };
  }
  if (/nothing was installed/i.test(text) || /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(text)) {
    return {
      result: "BLOCKED",
      exitCode: 3,
      integrationRan: [],
      reason: "Composition did not finish. This is not a product incompatibility verdict.",
    };
  }
  if (/added |installation complete|already installed/i.test(text)) {
    return {
      result: "BLOCKED",
      exitCode: 3,
      integrationRan: [],
      reason: "The host accepted the checkout, but the live TUI integration assertions have not run.",
    };
  }
  return {
    result: "BLOCKED",
    exitCode: 3,
    integrationRan: [],
    reason: "Composition output did not prove a version-gate rejection or a completed install.",
  };
}

function printResult(result) {
  console.log(`result: ${result.result}`);
  console.log(`reason: ${result.reason}`);
  console.log("integration assertions run:");
  if (result.integrationRan.length === 0) {
    console.log("  (none)");
  }
  for (const item of REQUIRED_INTEGRATION) {
    const ran = result.integrationRan.includes(item);
    console.log(`  [${ran ? "ran" : "not run"}] ${item}`);
  }
}

function classifyStdin() {
  const chunks = [];
  return new Promise((resolve) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const result = classifyComposition(Buffer.concat(chunks).toString("utf8"));
      printResult(result);
      resolve(result.exitCode);
    });
  });
}

function gitHead(dir) {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim();
}

function runComposition() {
  const tui = process.env.DSH_COMPAT_TUI;
  if (!tui) {
    console.error("DSH_COMPAT_TUI must point at the selected dsh-TUI checkout.");
    return 3;
  }
  const expectedTui = process.env.DSH_COMPAT_TUI_SHA;
  const head = gitHead(tui);
  if (expectedTui && head !== expectedTui) {
    console.error(`dsh-TUI HEAD ${head ?? "unreadable"} does not match ${expectedTui}`);
    return 3;
  }
  const manifest = JSON.parse(readFileSync(join(tui, "package.json"), "utf8"));
  if (manifest.name !== "@deepseek-harness-tui/dsh-tui") {
    console.error(`unexpected package at ${tui}: ${manifest.name ?? "missing name"}`);
    return 3;
  }

  const home = process.env.DSH_COMPAT_HOME ?? mkdtempSync(join(tmpdir(), "dsh-compat-"));
  mkdirSync(home, { recursive: true });
  const dshHome = join(home, ".dsh");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    DSH_HOME: dshHome,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
  };
  for (const dir of [env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, dshHome]) {
    mkdirSync(dir, { recursive: true });
  }

  const command = spawnSync(
    "dsh",
    ["plugin", "--profile", "dsh-tui", "add", tui],
    { env, encoding: "utf8" },
  );
  const log = `${command.stdout ?? ""}${command.stderr ?? ""}`;
  process.stdout.write(log);
  if (command.error) {
    console.error(command.error.message);
    return 3;
  }
  const result = classifyComposition(log);
  printResult(result);
  console.log(`dsh-tui manifest: ${manifest.name}@${manifest.version}`);
  console.log(`dsh-tui head: ${head ?? "not a git checkout"}`);
  console.log(`isolated home: ${home}`);
  return result.exitCode;
}

const mode = process.argv[2];
if (mode === "--classify") {
  process.exitCode = await classifyStdin();
} else if (mode === undefined) {
  process.exitCode = runComposition();
} else {
  console.error("usage: node scripts/upstream-compat.mjs [--classify]");
  process.exitCode = 3;
}
