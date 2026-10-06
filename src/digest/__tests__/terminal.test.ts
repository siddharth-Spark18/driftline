import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDigest } from "../terminal.ts";
import type { WorklistItem } from "../../scan/types.ts";

describe("renderDigest", () => {
  it("reports a clean bill of health when the worklist is empty", () => {
    const output = renderDigest([], { color: false });
    assert.match(output, /Nothing to report/);
  });

  it("includes no ANSI escape codes when color is disabled (cron/log-safe output)", () => {
    const items: WorklistItem[] = [
      { name: "foo", currentVersion: "1.0.0", latestVersion: "2.0.0", category: "breaking", reason: "Big change." },
    ];
    const output = renderDigest(items, { color: false });
    assert.doesNotMatch(output, /\x1b\[/);
  });

  it("includes ANSI escape codes when color is enabled", () => {
    const items: WorklistItem[] = [
      { name: "foo", currentVersion: "1.0.0", latestVersion: "2.0.0", category: "breaking", reason: "Big change." },
    ];
    const output = renderDigest(items, { color: true });
    assert.match(output, /\x1b\[/);
  });

  it("groups items under category headings in rank order and numbers them sequentially", () => {
    const items: WorklistItem[] = [
      { name: "low-pkg", currentVersion: "1.0.0", latestVersion: "1.1.0", category: "minor", reason: "New release." },
      {
        name: "vuln-pkg",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        category: "security",
        severity: "critical",
        reason: "RCE",
        advisoryUrl: "https://osv.dev/X",
      },
      { name: "major-pkg", currentVersion: "1.0.0", latestVersion: "2.0.0", category: "breaking", reason: "Removed API." },
    ];

    const output = renderDigest(items, { color: false, repoLabel: "/repo" });

    assert.match(output, /Learning Radar digest — \/repo/);
    assert.match(output, /1 security fix, 1 breaking change, 1 minor \/ feature update$/m);

    const securityIdx = output.indexOf("Security fixes");
    const breakingIdx = output.indexOf("Breaking changes");
    const minorIdx = output.indexOf("Minor / feature updates");
    assert.ok(securityIdx > -1 && breakingIdx > securityIdx && minorIdx > breakingIdx);

    assert.match(output, /1\. vuln-pkg \[CRITICAL\] \(1\.0\.0 -> 1\.0\.1\)/);
    assert.match(output, /2\. major-pkg \(1\.0\.0 -> 2\.0\.0\)/);
    assert.match(output, /3\. low-pkg \(1\.0\.0 -> 1\.1\.0\)/);
    assert.match(output, /https:\/\/osv\.dev\/X/);
  });

  it("pluralizes the summary line's category nouns when a count is greater than one", () => {
    const items: WorklistItem[] = [
      { name: "a", currentVersion: "1.0.0", latestVersion: "1.0.1", category: "security", reason: "r" },
      { name: "b", currentVersion: "1.0.0", latestVersion: "1.0.1", category: "security", reason: "r" },
    ];
    const output = renderDigest(items, { color: false });
    assert.match(output, /2 security fixes/);
    assert.doesNotMatch(output, /2 security fix,/);
  });

  it("omits a severity badge when severity is unknown", () => {
    const items: WorklistItem[] = [
      {
        name: "vuln-pkg",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        category: "security",
        severity: "unknown",
        reason: "Unscored advisory",
      },
    ];
    const output = renderDigest(items, { color: false });
    assert.doesNotMatch(output, /\[UNKNOWN\]/);
  });
});
