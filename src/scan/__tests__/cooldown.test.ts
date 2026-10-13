import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCooldown, cooldownMessage } from "../cooldown.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-13T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe("computeCooldown", () => {
  it("flags a release younger than the window", () => {
    assert.deepEqual(computeCooldown(ago(1), 3, NOW), { daysOld: 1 });
    assert.deepEqual(computeCooldown(ago(0), 3, NOW), { daysOld: 0 });
  });

  it("does not flag a release at or past the window", () => {
    assert.equal(computeCooldown(ago(3), 3, NOW), undefined);
    assert.equal(computeCooldown(ago(30), 3, NOW), undefined);
  });

  it("floors partial days", () => {
    assert.deepEqual(computeCooldown(new Date(NOW - 2.9 * DAY).toISOString(), 3, NOW), { daysOld: 2 });
  });

  it("yields nothing for a window of 0 (disabled)", () => {
    assert.equal(computeCooldown(ago(0), 0, NOW), undefined);
  });

  it("yields nothing for a missing or unparseable date", () => {
    assert.equal(computeCooldown(undefined, 3, NOW), undefined);
    assert.equal(computeCooldown("not-a-date", 3, NOW), undefined);
  });

  it("clamps a future publish date to 0 days old", () => {
    assert.deepEqual(computeCooldown(new Date(NOW + 5 * DAY).toISOString(), 3, NOW), { daysOld: 0 });
  });
});

describe("cooldownMessage", () => {
  it("words today, 1 day and N days", () => {
    assert.equal(cooldownMessage(0), "released today, consider waiting");
    assert.equal(cooldownMessage(1), "released 1 day ago, consider waiting");
    assert.equal(cooldownMessage(2), "released 2 days ago, consider waiting");
  });
});
