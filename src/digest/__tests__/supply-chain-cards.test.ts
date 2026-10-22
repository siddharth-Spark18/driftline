import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDigest } from "../terminal.ts";
import type { SkippedSummary, WorklistItem } from "../../scan/types.ts";

const zero = { "no-lockfile": 0, "unsupported-lockfile": 0, "lockfile-unreadable": 0, "not-in-lockfile": 0 };
const skipped = (count: number, total: number, reasons: Partial<typeof zero> = {}): SkippedSummary => ({ count, total, reasons: { ...zero, ...reasons } });

function item(overrides: Partial<WorklistItem> = {}): WorklistItem {
  return { name: "foo", currentVersion: "1.0.0", latestVersion: "2.0.0", category: "breaking", reason: "Big change.", ...overrides };
}

const evil = item({
  name: "@ctrl/tinycolor",
  currentVersion: "4.1.1",
  latestVersion: "4.2.0",
  category: "compromised",
  reason: "Malicious code in @ctrl/tinycolor (npm)",
  advisoryUrl: "https://osv.dev/vulnerability/MAL-2025-47141",
  otherAdvisoryCount: 2,
  safeVersions: { lastKnownGood: { version: "4.0.0" }, newestNotListedBad: { version: "4.2.0", cooldown: { daysOld: 1 } } },
  affectedFiles: [],
});
const plainOut = (items: WorklistItem[], options: Parameters<typeof renderDigest>[1] = {}) => renderDigest(items, { color: false, width: 80, ...options });

describe("renderDigest: compromised card", () => {
  const out = plainOut([item({ name: "vuln", category: "security", severity: "critical", reason: "RCE" }), evil]);

  it("renders a loud card ahead of security items, with a group header and summary entry", () => {
    assert.match(out, /^! Compromised packages \(1\)$/m);
    assert.match(out, /@ctrl\/tinycolor +\[COMPROMISED\] \|$/m);
    assert.match(out, /4\.1\.1 is listed as malicious/);
    assert.ok(out.indexOf("Compromised packages (1)") < out.indexOf("Security fixes (1)"));
    assert.match(out, /1 compromised package/);
    assert.match(out, /1\. @ctrl\/tinycolor/);
    assert.match(out, /2\. vuln/);
  });

  it("shows both labeled versions, the other-advisory count and the remediation hint", () => {
    assert.match(out, /Last known-good before the bad versions: 4\.0\.0/);
    assert.match(out, /Newest not listed as bad: 4\.2\.0 \(released 1 day ago, consider waiting;/);
    assert.match(out, /\+2 other advisories also affect this version/);
    assert.match(out, /Reinstall with npm ci, check install scripts, rotate credentials/);
    assert.match(out, /https:\/\/osv\.dev\/vulnerability\/MAL-2025-47141/);
    assert.doesNotMatch(out, /4\.1\.1 -> 4\.2\.0/);
  });

  it("uses singular for one other advisory and omits the line for none", () => {
    assert.match(plainOut([{ ...evil, otherAdvisoryCount: 1 }]), /\+1 other advisory also affect/);
    assert.doesNotMatch(plainOut([{ ...evil, otherAdvisoryCount: 0 }]), /other advisor/);
  });

  it("says when the version list couldn't be fetched", () => {
    assert.match(plainOut([{ ...evil, safeVersions: { lookupFailed: true } }]), /Couldn't determine a known-good version/);
  });

  it("flags an ignored compromised package and keeps all card lines the same width", () => {
    const ignored = plainOut([{ ...evil, ignored: true }]);
    assert.match(ignored, /on your ignore list \(shown because of this advisory\)/);
    for (const line of ignored.split("\n").filter((l) => l.startsWith("+-") || l.startsWith("|"))) assert.equal(line.length, 80, line);
  });

  it("uses a distinct ASCII icon without color and the double-bang glyph with color", () => {
    assert.match(plainOut([evil]), /^\| ! 1\. @ctrl\/tinycolor/m);
    assert.match(renderDigest([evil], { color: true, width: 80 }), /‼/);
  });
});

describe("renderDigest: fix line", () => {
  it("shows the fix, flags a major upgrade, and says when nothing is published", () => {
    const fix = plainOut([item({ category: "security", severity: "high", latestVersion: "5.0.0", currentVersion: "4.17.15", fixedVersion: "4.18.0" })]);
    assert.match(fix, /4\.17\.15 -> 5\.0\.0/);
    assert.match(fix, /Fix: 4\.18\.0 *\|$/m);
    const major = plainOut([item({ category: "security", fixedVersion: "0.2.4", fixNeedsMajorUpgrade: true })]);
    assert.match(major, /Fix: 0\.2\.4 \(needs a major upgrade\)/);
    const none = plainOut([item({ category: "security", noFixPublished: true })]);
    assert.match(none, /no fixed version published/);
    assert.doesNotMatch(plainOut([item({ category: "security" })]), /Fix:|no fixed version/);
  });

  it("does not show a fix line on non-security cards", () => {
    assert.doesNotMatch(plainOut([item({ category: "breaking", fixedVersion: "1.0.1" })]), /Fix:/);
  });
});

describe("renderDigest: skipped block", () => {
  const block = skipped(3, 5, { "unsupported-lockfile": 2, "not-in-lockfile": 1 });

  it("shows a warning block with the headline and reasons, above the results", () => {
    const out = plainOut([item()], { skipped: block });
    assert.match(out, /^! 3 of 5 packages were NOT checked: no installed version could be resolved\.$/m);
    assert.match(out, /^- 2 x a pnpm, yarn or bun lockfile was found/m);
    assert.match(out, /^- 1 x not found in package-lock\.json/m);
    assert.ok(out.indexOf("NOT checked") < out.indexOf("1. foo"));
    assert.ok(out.indexOf("NOT checked") > out.indexOf("Driftline digest"));
  });

  it("replaces the all-clear when nothing was reported", () => {
    const all = plainOut([], { skipped: skipped(5, 5, { "unsupported-lockfile": 5 }) });
    assert.match(all, /5 of 5 packages were NOT checked/);
    assert.match(all, /No packages could be checked, so there is nothing to report\./);
    assert.doesNotMatch(all, /Nothing to report — tracked|up to date|clear of known advisories/);
    const partial = plainOut([], { skipped: block });
    assert.match(partial, /Nothing to report for the packages that could be checked\./);
    assert.doesNotMatch(partial, /clear of known advisories/);
  });

  it("keeps every line within the digest width, including the prefixed headline (regression)", () => {
    const out = plainOut([item()], { skipped: block, width: 60 });
    for (const line of out.split("\n")) assert.ok(line.length <= 60, `line is ${line.length} wide: ${line}`);
    assert.match(out, /^! 3 of 5 packages were NOT checked/m);
  });

  it("keeps the all-clear only when nothing was skipped", () => {
    for (const options of [{}, { skipped: skipped(0, 4) }]) {
      const out = plainOut([], options);
      assert.match(out, /Nothing to report — tracked dependencies are up to date and clear of known advisories\./);
      assert.doesNotMatch(out, /NOT checked/);
    }
  });

  it("is plain text without color and styled with color", () => {
    assert.doesNotMatch(plainOut([item()], { skipped: block }), /\x1b\[/);
    assert.match(renderDigest([item()], { color: true, width: 80, skipped: block }), /\x1b\[[0-9;]*m.*NOT checked/);
  });
});

describe("renderDigest: limits footer", () => {
  it("ends every digest with the honest-limits line, empty or not", () => {
    const footer = /Based on OSV\.dev and npm registry data, which can lag\./;
    assert.match(plainOut([]), footer);
    assert.match(plainOut([item()]), footer);
    assert.match(plainOut([item()], { ignored: 2, overflow: 1 }), footer);
    assert.match(plainOut([item()]).replace(/\n/g, " "), /no version is guaranteed clean/);
  });

  it("places the footer after the overflow and ignored notes", () => {
    const out = plainOut([item()], { ignored: 2, overflow: 3 });
    assert.ok(out.indexOf("+3 more") < out.indexOf("2 ignored"));
    assert.ok(out.indexOf("2 ignored") < out.indexOf("Based on OSV.dev"));
  });
});
