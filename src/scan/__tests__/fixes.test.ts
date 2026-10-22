import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Advisory, AffectedInterval } from "../advisories.ts";
import { chooseFix, chooseSafeVersions, isAffected } from "../fixes.ts";

function advisory(intervals: AffectedInterval[], overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: "ADV-1",
    summary: "s",
    severity: "high",
    url: "https://osv.dev/ADV-1",
    kind: "vulnerability",
    intervals,
    fixedVersions: intervals.flatMap((i) => (i.fixed ? [i.fixed] : [])),
    affectedVersions: [],
    ...overrides,
  };
}

describe("chooseFix: prereleases", () => {
  it("never recommends a prerelease as the fix (regression)", () => {
    assert.deepEqual(chooseFix("1.0.0", [advisory([{ introduced: "0", fixed: "1.0.1-rc.1" }])]), {});
  });

  it("prefers a stable fix over a lower prerelease fix", () => {
    const a = advisory([{ introduced: "0", fixed: "1.0.1-rc.1" }], { id: "A" });
    const b = advisory([{ introduced: "0", fixed: "1.0.2" }], { id: "B" });
    assert.deepEqual(chooseFix("1.0.0", [a, b]), { fixedVersion: "1.0.2" });
  });

  it("allows a prerelease fix when the user is already on a prerelease", () => {
    assert.deepEqual(chooseFix("1.0.1-beta.1", [advisory([{ introduced: "0", fixed: "1.0.1-rc.1" }])]), { fixedVersion: "1.0.1-rc.1" });
  });
});

describe("isAffected", () => {
  it("honours introduced (inclusive), fixed (exclusive) and last_affected (inclusive)", () => {
    const fixed = advisory([{ introduced: "1.0.0", fixed: "1.2.0" }]);
    assert.equal(isAffected("1.0.0", fixed), true);
    assert.equal(isAffected("1.1.9", fixed), true);
    assert.equal(isAffected("1.2.0", fixed), false);
    assert.equal(isAffected("0.9.0", fixed), false);
    const last = advisory([{ introduced: "0", lastAffected: "4.1.2" }]);
    assert.equal(isAffected("4.1.2", last), true);
    assert.equal(isAffected("4.1.3", last), false);
    assert.equal(isAffected("0.0.1", last), true);
  });

  it("treats an open interval as affecting everything above introduced", () => {
    assert.equal(isAffected("99.0.0", advisory([{ introduced: "0" }])), true);
  });

  it("matches an explicit version list even when the version is not semver", () => {
    assert.equal(isAffected("weird", advisory([], { affectedVersions: ["weird"] })), true);
    assert.equal(isAffected("weird", advisory([])), false);
  });
});

describe("chooseFix: release line", () => {
  it("picks the fix in the same major", () => {
    const adv = advisory([{ introduced: "0", fixed: "4.18.0" }]);
    assert.deepEqual(chooseFix("4.17.15", [adv]), { fixedVersion: "4.18.0" });
  });

  it("picks the fix of the matching release line across several lines", () => {
    const adv = advisory([
      { introduced: "0", fixed: "0.7.30" },
      { introduced: "0.8.0", fixed: "0.8.1" },
      { introduced: "1.0.0", fixed: "1.0.1" },
    ]);
    assert.deepEqual(chooseFix("0.7.29", [adv]), { fixedVersion: "0.7.30" });
    assert.deepEqual(chooseFix("0.8.0", [adv]), { fixedVersion: "0.8.1" });
    assert.deepEqual(chooseFix("1.0.0", [adv]), { fixedVersion: "1.0.1" });
  });

  it("requires the same minor for 0.x, so a different minor needs a major upgrade", () => {
    const adv = advisory([{ introduced: "0", fixed: "0.2.4" }, { introduced: "1.0.0", fixed: "1.2.6" }]);
    assert.deepEqual(chooseFix("0.0.8", [adv]), { fixedVersion: "0.2.4", fixNeedsMajorUpgrade: true });
    assert.deepEqual(chooseFix("0.2.1", [adv]), { fixedVersion: "0.2.4" });
  });

  it("flags a fix in a higher major as needing a major upgrade", () => {
    const adv = advisory([{ introduced: "0", fixed: "2.0.0" }]);
    assert.deepEqual(chooseFix("1.5.0", [adv]), { fixedVersion: "2.0.0", fixNeedsMajorUpgrade: true });
  });

  it("is a same-major fix (not a major upgrade) for a fix in the same 1.x+ major but higher minor", () => {
    const adv = advisory([{ introduced: "1.0.0", fixed: "1.9.0" }]);
    assert.deepEqual(chooseFix("1.2.0", [adv]), { fixedVersion: "1.9.0" });
  });
});

describe("chooseFix: covers every advisory", () => {
  it("returns a version that fixes all advisories, not just the lowest fix", () => {
    const a = advisory([{ introduced: "0", fixed: "4.17.19" }], { id: "A" });
    const b = advisory([{ introduced: "0", fixed: "4.17.21" }], { id: "B" });
    assert.deepEqual(chooseFix("4.17.15", [a, b]), { fixedVersion: "4.17.21" });
    assert.deepEqual(chooseFix("4.17.15", [b, a]), { fixedVersion: "4.17.21" });
  });

  it("skips a candidate fix that another interval still lists as affected", () => {
    const adv = advisory([{ introduced: "0", fixed: "4.17.5" }, { introduced: "4.0.0", fixed: "4.18.0" }]);
    assert.deepEqual(chooseFix("4.17.0", [adv]), { fixedVersion: "4.18.0" });
  });

  it("ignores advisories that do not affect the installed version", () => {
    const hit = advisory([{ introduced: "0", fixed: "1.1.0" }], { id: "hit" });
    const miss = advisory([{ introduced: "2.0.0", fixed: "3.0.0" }], { id: "miss" });
    assert.deepEqual(chooseFix("1.0.0", [hit]), { fixedVersion: "1.1.0" });
    // `miss` does not contain 1.0.0 and is not listed by version, so no claim can be made for it.
    assert.deepEqual(chooseFix("1.0.0", [hit, miss]), {});
  });
});

describe("chooseFix: no claim", () => {
  it("reports noFixPublished when an interval has no fixed version", () => {
    assert.deepEqual(chooseFix("1.0.0", [advisory([{ introduced: "0" }])]), { noFixPublished: true });
    assert.deepEqual(chooseFix("4.1.1", [advisory([{ introduced: "0", lastAffected: "4.1.2" }])]), { noFixPublished: true });
  });

  it("reports noFixPublished when any one advisory lacks a fix, even if another has one", () => {
    const fixable = advisory([{ introduced: "0", fixed: "1.1.0" }]);
    const unfixable = advisory([{ introduced: "0" }]);
    assert.deepEqual(chooseFix("1.0.0", [fixable, unfixable]), { noFixPublished: true });
  });

  it("makes no claim for an unparsable installed version, no advisories, or version-list-only advisories", () => {
    const adv = advisory([{ introduced: "0", fixed: "1.1.0" }]);
    assert.deepEqual(chooseFix("not-a-version", [adv]), {});
    assert.deepEqual(chooseFix("1.0.0", []), {});
    assert.deepEqual(chooseFix("1.0.0", [advisory([], { affectedVersions: ["1.0.0"] })]), {});
  });

  it("does not crash on unparsable interval bounds", () => {
    assert.deepEqual(chooseFix("1.0.0", [advisory([{ introduced: "garbage", fixed: "1.1.0" }])]), {});
    const result = chooseFix("1.0.0", [advisory([{ introduced: "0", fixed: "latest" }])]);
    assert.equal(result.fixedVersion, undefined);
    assert.equal(result.fixNeedsMajorUpgrade, undefined);
  });

  it("treats the final release as the fix for a prerelease of the same version", () => {
    assert.deepEqual(chooseFix("1.0.0-beta.1", [advisory([{ introduced: "0", fixed: "1.0.0" }])]), { fixedVersion: "1.0.0" });
  });

  it("handles a prerelease installed version without crashing", () => {
    const adv = advisory([{ introduced: "0", fixed: "2.0.0" }]);
    assert.deepEqual(chooseFix("1.9.0-rc.1", [adv]), { fixedVersion: "2.0.0", fixNeedsMajorUpgrade: true });
  });
});

describe("chooseSafeVersions", () => {
  const NOW = Date.parse("2026-10-22T12:00:00Z");
  const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const malList = advisory([], { kind: "compromised", affectedVersions: ["1.0.2", "1.0.3"] });

  it("picks the last known-good below the bad versions and the newest not listed as bad", () => {
    const result = chooseSafeVersions(
      ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.1.0", "1.2.0"],
      { "1.0.1": day(200), "1.2.0": day(40) },
      "1.0.2",
      [malList],
      3,
      NOW,
    );
    assert.deepEqual(result, {
      lastKnownGood: { version: "1.0.1", releasedAt: day(200) },
      newestNotListedBad: { version: "1.2.0", releasedAt: day(40) },
    });
  });

  it("sorts the version list itself and ignores unparsable entries", () => {
    const result = chooseSafeVersions(["1.2.0", "junk", "1.0.0", "1.0.2", "1.0.3"], {}, "1.0.2", [malList], 3, NOW);
    assert.equal(result.lastKnownGood?.version, "1.0.0");
    assert.equal(result.newestNotListedBad?.version, "1.2.0");
  });

  it("never suggests a prerelease", () => {
    const result = chooseSafeVersions(["1.0.0", "1.0.2", "1.0.3", "2.0.0-beta.1", "1.1.0-rc.1"], {}, "1.0.2", [malList], 3, NOW);
    assert.equal(result.lastKnownGood?.version, "1.0.0");
    assert.equal(result.newestNotListedBad?.version, "1.0.0");
    const onlyPre = chooseSafeVersions(["1.0.2", "2.0.0-beta.1"], {}, "1.0.2", [malList], 3, NOW);
    assert.deepEqual(onlyPre, { lookupFailed: true });
  });

  it("treats the installed version as bad even when the advisory does not list it", () => {
    const result = chooseSafeVersions(["1.0.0", "1.0.1", "1.0.2"], {}, "1.0.1", [advisory([], { kind: "compromised" })], 3, NOW);
    assert.equal(result.lastKnownGood?.version, "1.0.0");
    assert.equal(result.newestNotListedBad?.version, "1.0.2");
  });

  it("with a range that covers everything up to last_affected there is no last known-good", () => {
    const range = advisory([{ introduced: "0", lastAffected: "4.1.2" }], { kind: "compromised", affectedVersions: ["4.1.1", "4.1.2"] });
    const result = chooseSafeVersions(["4.0.0", "4.1.0", "4.1.1", "4.1.2", "4.2.0"], {}, "4.1.1", [range], 3, NOW);
    assert.equal(result.lastKnownGood, undefined);
    assert.equal(result.newestNotListedBad?.version, "4.2.0");
    assert.equal(result.lookupFailed, undefined);
  });

  it("adds a cooldown flag to a young suggestion and leaves old ones unflagged", () => {
    const result = chooseSafeVersions(["1.0.0", "1.0.2", "1.0.3", "1.1.0"], { "1.0.0": day(300), "1.1.0": day(1) }, "1.0.2", [malList], 3, NOW);
    assert.deepEqual(result.newestNotListedBad, { version: "1.1.0", releasedAt: day(1), cooldown: { daysOld: 1 } });
    assert.equal(result.lastKnownGood?.cooldown, undefined);
    const disabled = chooseSafeVersions(["1.0.0", "1.0.2", "1.0.3", "1.1.0"], { "1.1.0": day(1) }, "1.0.2", [malList], 0, NOW);
    assert.equal(disabled.newestNotListedBad?.cooldown, undefined);
  });

  it("omits releasedAt when the registry has no publish time for the version", () => {
    const result = chooseSafeVersions(["1.0.0", "1.0.2"], {}, "1.0.2", [malList], 3, NOW);
    assert.deepEqual(result.lastKnownGood, { version: "1.0.0" });
  });

  it("reports lookupFailed for an empty list or one with nothing usable", () => {
    assert.deepEqual(chooseSafeVersions([], {}, "1.0.2", [malList], 3, NOW), { lookupFailed: true });
    assert.deepEqual(chooseSafeVersions(["1.0.2", "1.0.3"], {}, "1.0.2", [malList], 3, NOW), { lookupFailed: true });
    assert.deepEqual(chooseSafeVersions(["nope"], {}, "1.0.2", [malList], 3, NOW), { lookupFailed: true });
  });

  it("returns just the newest when every good version is above the bad ones", () => {
    const result = chooseSafeVersions(["1.0.2", "1.0.3", "1.1.0"], {}, "1.0.2", [malList], 3, NOW);
    assert.equal(result.lastKnownGood, undefined);
    assert.equal(result.newestNotListedBad?.version, "1.1.0");
  });
});
