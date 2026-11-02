import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatSessionAge, shortenPath } from "../src/session-format.js";

test("formatSessionAge formats DSH session timestamps at unit boundaries", () => {
  const now = Date.UTC(2026, 0, 1);
  const day = 24 * 60 * 60 * 1000;
  const cases: Array<[number, string]> = [
    [-60_000, "now"],
    [0, "now"],
    [59_999, "now"],
    [60_000, "1m"],
    [59 * 60_000, "59m"],
    [60 * 60_000, "1h"],
    [day, "1d"],
    [7 * day, "1w"],
    [30 * day, "1mo"],
    [365 * day, "1y"],
  ];
  for (const [age, expected] of cases) {
    assert.equal(formatSessionAge(new Date(now - age), now), expected);
  }
});

test("shortenPath abbreviates the home directory for DSH session labels", () => {
  assert.equal(shortenPath(homedir()), "~");
  assert.equal(shortenPath(join(homedir(), "project")), "~/project");
  assert.equal(shortenPath("relative/project"), "relative/project");
});
