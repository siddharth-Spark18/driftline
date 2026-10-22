import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SkippedSummary } from "../../scan/types.ts";
import { describeSafeVersion, LIMITS_FOOTER, LIMITS_NOTES, safeVersionLines, skippedEmptyText, skippedHeadline, skippedReasonLines } from "../notes.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const zero = { "no-lockfile": 0, "unsupported-lockfile": 0, "lockfile-unreadable": 0, "not-in-lockfile": 0 };
const skipped = (count: number, total: number, reasons: Partial<typeof zero> = {}): SkippedSummary => ({ count, total, reasons: { ...zero, ...reasons } });

describe("skipped wording", () => {
  it("headline uses singular and plural correctly", () => {
    assert.equal(skippedHeadline(skipped(3, 5)), "3 of 5 packages were NOT checked: no installed version could be resolved.");
    assert.equal(skippedHeadline(skipped(1, 1)), "1 of 1 package was NOT checked: no installed version could be resolved.");
    assert.equal(skippedHeadline(skipped(1, 4)), "1 of 4 packages was NOT checked: no installed version could be resolved.");
  });

  it("lists only the reasons that apply, in a fixed order", () => {
    const lines = skippedReasonLines(skipped(6, 6, { "not-in-lockfile": 1, "no-lockfile": 2, "unsupported-lockfile": 3 }));
    assert.deepEqual(lines, [
      "2 x no package-lock.json found",
      "3 x a pnpm, yarn or bun lockfile was found, but only package-lock.json is read",
      "1 x not found in package-lock.json",
    ]);
    assert.deepEqual(skippedReasonLines(skipped(1, 1, { "lockfile-unreadable": 1 })), ["1 x package-lock.json could not be read"]);
    assert.deepEqual(skippedReasonLines(skipped(0, 3)), []);
  });

  it("never says all clear when something was skipped", () => {
    assert.equal(skippedEmptyText(skipped(4, 4)), "No packages could be checked, so there is nothing to report.");
    assert.equal(skippedEmptyText(skipped(1, 4)), "Nothing to report for the packages that could be checked.");
    assert.doesNotMatch(skippedEmptyText(skipped(1, 4)), /clear|up to date/i);
  });
});

describe("limits wording", () => {
  it("states the honest limits and never claims safety", () => {
    const text = LIMITS_NOTES.join("\n");
    assert.match(text, /OSV\.dev/);
    assert.match(text, /lag/);
    assert.match(text, /Transitive dependencies are not scanned/);
    assert.match(text, /not checked for advisories/);
    assert.match(text, /cooldown/);
    assert.match(text, /not guaranteed clean/);
    assert.match(LIMITS_FOOTER, /OSV\.dev and npm registry data, which can lag/);
    assert.match(LIMITS_FOOTER, /no version is guaranteed clean/);
    assert.ok(LIMITS_FOOTER.split("\n").length === 1);
  });
});

describe("safe version wording", () => {
  it("describes cooldown, age and missing dates", () => {
    assert.equal(
      describeSafeVersion({ version: "1.2.0", releasedAt: "2026-10-21T12:00:00.000Z", cooldown: { daysOld: 1 } }, NOW),
      "1.2.0 (released 1 day ago, consider waiting; a wait lowers risk but proves nothing)",
    );
    assert.equal(describeSafeVersion({ version: "1.0.0", releasedAt: "2026-07-14T12:00:00.000Z" }, NOW), "1.0.0 (published 100 days ago)");
    assert.equal(describeSafeVersion({ version: "1.0.0" }, NOW), "1.0.0");
    assert.equal(describeSafeVersion({ version: "1.0.0", releasedAt: "garbage" }, NOW), "1.0.0");
  });

  it("labels both suggestions as not-listed-as-bad, never 'safe'", () => {
    const lines = safeVersionLines(
      { lastKnownGood: { version: "1.0.0" }, newestNotListedBad: { version: "1.2.0", cooldown: { daysOld: 0 } } },
      NOW,
    );
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^Last known-good before the bad versions: 1\.0\.0$/);
    assert.match(lines[1], /^Newest not listed as bad: 1\.2\.0 \(released today, consider waiting/);
    assert.doesNotMatch(lines.join("\n"), /\bsafe\b/i);
  });

  it("falls back to a could-not-determine line when missing or lookup failed", () => {
    for (const value of [undefined, { lookupFailed: true }]) {
      assert.deepEqual(safeVersionLines(value, NOW), ["Couldn't determine a known-good version (registry version list unavailable)."]);
    }
    assert.deepEqual(safeVersionLines({}, NOW), []);
    assert.equal(safeVersionLines({ newestNotListedBad: { version: "2.0.0" } }, NOW).length, 1);
  });
});
