import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

test("CI routes Ubuntu computation to Modal and macOS to CircleCI without local runners", () => {
  const github = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(github, /types: \[opened, synchronize, reopened\]/);
  assert.match(github, /fetch-depth: 0/);
  assert.equal(github.includes("matrix:"), false);
  assert.equal((github.match(/^  ubuntu:/gm) ?? []).length, 1);
  assert.match(github, /persist-credentials: false/);
  assert.match(github, /python ci\/modal_ci.py/);
  assert.equal(github.includes("actions/setup-node"), false);
  assert.equal(github.includes("self-hosted"), false);
  assert.equal(github.includes("pull_request_target:"), false);
  const settings = readFileSync("ci/settings.py", "utf8");
  assert.equal((settings.match(/"suite": "package"/g) ?? []).length, 2);
  assert.equal((settings.match(/"suite": "live"/g) ?? []).length, 2);
  assert.equal((github.match(/python ci\/modal_ci.py/g) ?? []).length, 1);
  const circle = readFileSync(".circleci/config.yml", "utf8");
  assert.match(circle, /xcode: "26.4.1"/);
  assert.match(circle, /resource_class: m4pro.medium/);
  assert.equal(circle.includes("docker:"), false);
  assert.equal(circle.includes("MODAL_TOKEN"), false);
  assert.match(circle, /node: circleci\/node@7.2.1/);
  for (const cell of ["macos-package-node22", "macos-package-node24", "macos-live-validated", "macos-live-merged-022"]) {
    assert.ok(circle.includes(`name: ${cell}`));
  }
  for (const version of ["22.23.4", "24.22.1"]) {
    assert.equal((circle.match(new RegExp(`node-version: "${version.replaceAll(".", "\\.")}"`, "g")) ?? []).length, 2);
    assert.ok(settings.includes(`"${version}"`));
  }
  const suite = readFileSync(".circleci/test-suites.yml", "utf8");
  assert.match(suite, /<< test.atoms >>/);
  assert.match(suite, /<< outputs.junit >>/);
  assert.equal(suite.includes("options:"), false);
});

test("CI event policy accepts own PRs, main pushes and manual runs, not forks or tags", () => {
  const githubText = readFileSync(".github/workflows/ci.yml", "utf8");
  const githubCondition = githubText.match(/    if: >-\n((?:      .*\n)+)/)![1]!.trim().replace(/\s+/g, " ");
  for (const [event, repo, head, expected] of [
    ["push", "hyein-cbio/dsh-session-cleanup", "", true],
    ["workflow_dispatch", "hyein-cbio/dsh-session-cleanup", "", true],
    ["pull_request", "hyein-cbio/dsh-session-cleanup", "hyein-cbio/dsh-session-cleanup", true],
    ["pull_request", "hyein-cbio/dsh-session-cleanup", "fork/repo", false],
    ["push", "fork/repo", "", false],
    ["pull_request_target", "hyein-cbio/dsh-session-cleanup", "fork/repo", false],
  ] as const) {
    const github = { event_name: event, repository: repo, event: { pull_request: { head: { repo: { full_name: head } } } } };
    assert.equal(runInNewContext(githubCondition, { github }), expected);
  }
  const circle = readFileSync(".circleci/config.yml", "utf8");
  const expression = circle.match(/    when: >-\n((?:      .*\n)+)    jobs:/)![1]!.trim().replace(/\s+/g, " ");
  const predicate = expression.replace(/\band\b/g, "&&").replace(/\bor\b/g, "||");
  for (const [name, action, ref, expected] of [
    ["api", "api", "", true],
    ["push", "push", "refs/heads/main", true],
    ["push", "push", "refs/heads/feature", false],
    ["push", "push", "refs/tags/v1", false],
    ["push", "push", "refs/tags/main", false],
    ["pull_request", "opened", "", true],
    ["pull_request", "synchronize", "", true],
    ["pull_request", "reopened", "", true],
    ["pull_request", "closed", "", false],
    ["pull_request", "ready_for_review", "", false],
    ["schedule", "schedule", "", false],
  ] as const) {
    assert.equal(runInNewContext(predicate, { pipeline: { event: { name, action, github: { ref } } } }), expected);
  }
  // CircleCI GitHub App fork exclusion is a server-side integration policy,
  // not something this workflow expression or local truth table can establish.
});

test("CircleCI JUnit contains compiled test atoms but not payloads or absolute paths", async () => {
  const { default: reporter } = await import(pathToFileURL(resolve("ci/junit-reporter.mjs")).href);
  const data = { file: resolve(".test-dist/test/ci.test.js"), name: "private payload",
    details: { duration_ms: 12, error: new Error("private payload") } };
  const events = [
    { type: "test:stdout", data: { message: "private payload" } },
    { type: "test:pass", data },
    { type: "test:fail", data },
    { type: "test:pass", data: { ...data, skip: "private payload" } },
    { type: "test:pass", data: { ...data, details: { type: "suite" } } },
  ];
  let xml = "";
  for await (const chunk of reporter(events)) xml += chunk;
  assert.equal((xml.match(/<testcase /g) ?? []).length, 3);
  assert.ok(xml.includes('file=".test-dist/test/ci.test.js"'));
  assert.ok(xml.includes('name="test-2"'));
  assert.ok(xml.includes('time="0.012"'));
  assert.ok(xml.includes('<failure message="Test failed">'));
  assert.ok(xml.includes("<skipped/>"));
  assert.equal(xml.includes("private payload"), false);
  assert.equal(xml.includes(process.cwd()), false);
  await assert.rejects(async () => {
    for await (const chunk of reporter([{ type: "test:pass", data: { file: "/tmp/private.test.js" } }])) void chunk;
  }, /unexpected test file/);
});
