import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capWorklist, rankWorklist } from "../rank.ts";
import type { WorklistItem } from "../types.ts";

function item(name: string, category: WorklistItem["category"], severity?: WorklistItem["severity"]): WorklistItem {
  return { name, currentVersion: "1.0.0", latestVersion: "2.0.0", category, severity, reason: "r" };
}

describe("rankWorklist with compromised items", () => {
  it("puts compromised above critical security, then security, breaking, deprecation, minor", () => {
    const ranked = rankWorklist([
      item("minor", "minor"),
      item("dep", "deprecation"),
      item("brk", "breaking"),
      item("crit", "security", "critical"),
      item("evil", "compromised"),
    ]);
    assert.deepEqual(ranked.map((i) => i.name), ["evil", "crit", "brk", "dep", "minor"]);
  });

  it("orders compromised items by name and ignores severity for them", () => {
    const ranked = rankWorklist([item("zed", "compromised", "critical"), item("alpha", "compromised", "unknown")]);
    assert.deepEqual(ranked.map((i) => i.name), ["alpha", "zed"]);
  });
});

describe("capWorklist", () => {
  const ranked = rankWorklist([
    item("m1", "minor"),
    item("m2", "minor"),
    item("s1", "security", "low"),
    item("s2", "security", "high"),
    item("s3", "security", "moderate"),
    item("evil", "compromised"),
  ]);

  it("never drops compromised or security items, even past the cap", () => {
    const { items, overflow } = capWorklist(ranked, 1);
    assert.deepEqual(items.map((i) => i.name), ["evil", "s2", "s3", "s1"]);
    assert.equal(overflow, 2);
  });

  it("fills the remaining room with lower categories", () => {
    const { items, overflow } = capWorklist(ranked, 5);
    assert.equal(items.length, 5);
    assert.equal(items[4].name, "m1");
    assert.equal(overflow, 1);
  });

  it("keeps everything when the cap is larger than the list", () => {
    assert.deepEqual(capWorklist(ranked, 100), { items: ranked, overflow: 0 });
  });

  it("keeps a lone compromised item at a cap of 1 and drops the rest", () => {
    const { items, overflow } = capWorklist([item("evil", "compromised"), item("m", "minor"), item("b", "breaking")], 1);
    assert.deepEqual(items.map((i) => i.name), ["evil"]);
    assert.equal(overflow, 2);
  });
});
