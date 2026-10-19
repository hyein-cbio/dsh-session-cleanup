import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildAgentSelectionMenu,
  discoverSelectableAgents,
  resolveTargetAgentForSessionNix,
} from "../src/agent-target.js";
import { createAgentTestFixture } from "./helpers/fixtures.js";
import { withEnv } from "./helpers/env.js";

test("buildAgentSelectionMenu marks the current agent and preserves labels", () => {
  const menu = buildAgentSelectionMenu(
    [
      { name: "code", description: "General coding", mode: "primary" },
      { name: "review", description: "Reviews changes", mode: "subagent" },
    ],
    "review",
  );

  assert.deepEqual(menu.labels, [
    "○ code [primary] — General coding",
    "● review [subagent] — Reviews changes",
  ]);
  assert.equal(menu.valueByLabel.get(menu.labels[1] ?? ""), "review");
});

test("discoverSelectableAgents reads nearest project agents and lets them override agent-dir agents", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-session-cleanup-agent-target-"));

  try {
    const runtimeDir = join(tempDir, "runtime");
    const runtimeAgentsDir = join(runtimeDir, "agents");
    const projectDir = join(tempDir, "project");
    const nestedCwd = join(projectDir, "packages", "demo");
    const projectAgentsDir = join(projectDir, ".pi", "agents");

    mkdirSync(runtimeAgentsDir, { recursive: true });
    mkdirSync(projectAgentsDir, { recursive: true });
    mkdirSync(nestedCwd, { recursive: true });

    writeFileSync(
      join(runtimeAgentsDir, "release-agent.md"),
      "---\nname: release-agent\ndescription: Runtime copy\nmode: primary\n---\n",
      "utf8",
    );
    writeFileSync(
      join(projectAgentsDir, "release-agent.md"),
      "---\nname: release-agent\ndescription: Project copy\nmode: subagent\n---\n",
      "utf8",
    );

    await withEnv({ PI_CODING_AGENT_DIR: runtimeDir }, () => {
      const agents = discoverSelectableAgents(nestedCwd);
      const releaseAgent = agents.find((agent) => agent.name === "release-agent");

      assert.ok(releaseAgent, "expected project agent to be discovered");
      assert.equal(releaseAgent.description, "Project copy");
      assert.equal(releaseAgent.mode, "subagent");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveTargetAgentForSessionNix selects an agent through the basic selector", async () => {
  const fixture = createAgentTestFixture("pi-session-cleanup-agent-select-");
  const notices: Array<{ message: string; type?: string }> = [];
  const titles: string[] = [];

  try {
    await withEnv({ PI_CODING_AGENT_DIR: fixture.runtimeDir }, async () => {
      const selected = await resolveTargetAgentForSessionNix(
        {
          cwd: fixture.cwd,
          hasUI: true,
          ui: {
            notify(message: string, type?: string) {
              notices.push({ message, type });
            },
            select: async (title: string, labels: string[]) => {
              titles.push(title);
              return labels.find((label) => label.includes("release-agent"));
            },
          },
        } as never,
        undefined,
        "code",
      );

      assert.equal(selected?.name, "release-agent");
      assert.equal(titles[0], "Select a target agent");
      assert.equal(notices.length, 0);

      const cancelled = await resolveTargetAgentForSessionNix(
        {
          cwd: fixture.cwd,
          hasUI: true,
          ui: {
            notify(message: string, type?: string) {
              notices.push({ message, type });
            },
            select: async () => undefined,
          },
        } as never,
        undefined,
        null,
      );
      assert.equal(cancelled, null);

      const headless = await resolveTargetAgentForSessionNix(
        {
          cwd: fixture.cwd,
          hasUI: false,
          ui: {
            notify(message: string, type?: string) {
              notices.push({ message, type });
            },
            select: async () => {
              throw new Error("basic selector should not run without a UI");
            },
          },
        } as never,
        undefined,
        null,
      );
      assert.equal(headless, undefined);
      assert.equal(notices.at(-1)?.type, "warning");
      assert.match(notices.at(-1)?.message ?? "", /non-interactive mode/);
    });
  } finally {
    fixture.cleanup();
  }
});
