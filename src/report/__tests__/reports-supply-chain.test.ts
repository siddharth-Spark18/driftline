import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIMITS_NOTES } from "../../digest/notes.ts";
import type { SkippedSummary, WorklistItem } from "../../scan/types.ts";
import { buildJsonReport } from "../json.ts";
import { buildMarkdownReport } from "../markdown.ts";
import type { ReportData } from "../types.ts";

const zero = { "no-lockfile": 0, "unsupported-lockfile": 0, "lockfile-unreadable": 0, "not-in-lockfile": 0 };
const skipped = (count: number, total: number, reasons: Partial<typeof zero> = {}): SkippedSummary => ({ count, total, reasons: { ...zero, ...reasons } });

const worklist: WorklistItem[] = [
  {
    name: "@ctrl/tinycolor",
    currentVersion: "4.1.1",
    latestVersion: "4.2.0",
    category: "compromised",
    reason: "Malicious code in @ctrl/tinycolor (npm)",
    advisoryUrl: "https://osv.dev/vulnerability/MAL-2025-47141",
    advisoryIds: ["MAL-2025-47141"],
    otherAdvisoryCount: 1,
    safeVersions: { lastKnownGood: { version: "4.0.0" }, newestNotListedBad: { version: "4.2.0", cooldown: { daysOld: 1 } } },
    affectedFiles: [{ path: "src/a.ts", confidence: "high" }],
    prompt: "Investigate it.",
  },
  { name: "lodash", currentVersion: "4.17.15", latestVersion: "5.0.0", category: "security", severity: "high", reason: "Prototype pollution", fixedVersion: "4.18.0" },
  { name: "minimist", currentVersion: "0.0.8", latestVersion: "1.2.8", category: "security", severity: "critical", reason: "PP", fixedVersion: "0.2.4", fixNeedsMajorUpgrade: true },
  { name: "unfixed", currentVersion: "1.0.0", latestVersion: "1.5.0", category: "security", severity: "low", reason: "Open", noFixPublished: true },
  { name: "tiny", currentVersion: "1.0.0", latestVersion: "1.1.0", category: "minor", reason: "New." },
];

function data(overrides: Partial<ReportData> = {}): ReportData {
  return { scannedAt: "2026-10-22T10:00:00.000Z", repo: "/tmp/repo", driftlineVersion: "0.1.0", overflow: 0, worklist, ...overrides };
}

describe("markdown report: supply-chain content", () => {
  const md = buildMarkdownReport(data({ skipped: skipped(2, 7, { "unsupported-lockfile": 2 }) }));

  it("has a compromised section first, with a COMPROMISED heading and both labeled versions", () => {
    assert.match(md, /## Compromised packages \(1\)/);
    assert.ok(md.indexOf("## Compromised packages") < md.indexOf("## Security fixes"));
    assert.match(md, /### 1\. @ctrl\/tinycolor \[COMPROMISED\]/);
    assert.match(md, /\*\*`4\.1\.1` is listed as malicious\.\*\*/);
    assert.match(md, /- Last known-good before the bad versions: 4\.0\.0/);
    assert.match(md, /- Newest not listed as bad: 4\.2\.0 \(released 1 day ago, consider waiting;/);
    assert.match(md, /not being listed as bad does not prove a release is clean/);
    assert.match(md, /- 1 other advisory also affects this version/);
    assert.match(md, /- Advisory: https:\/\/osv\.dev\/vulnerability\/MAL-2025-47141/);
    assert.match(md, /- Affected files:\n {2}- `src\/a\.ts` \(high confidence\)/);
    assert.match(md, /Agent prompt:\n\n```text\nInvestigate it\.\n```/);
  });

  it("has fix lines for security items", () => {
    assert.match(md, /- Fix: `4\.18\.0`\n/);
    assert.match(md, /- Fix: `0\.2\.4` \(needs a major upgrade\)/);
    assert.match(md, /- Fix: no fixed version published/);
  });

  it("counts compromised in the summary", () => {
    const summary = md.slice(md.indexOf("## Summary"), md.indexOf("## Compromised"));
    assert.match(summary, /- 1 compromised package\n- 3 security fixes\n- 1 minor \/ feature update/);
  });

  it("has a skipped warning section before the summary", () => {
    assert.match(md, /## Warning: packages not checked\n\n2 of 7 packages were NOT checked/);
    assert.match(md, /- 2 x a pnpm, yarn or bun lockfile was found/);
    assert.ok(md.indexOf("## Warning") < md.indexOf("## Summary"));
  });

  it("ends with a Notes section carrying every limits note", () => {
    const notes = md.slice(md.indexOf("## Notes"));
    for (const note of LIMITS_NOTES) assert.ok(notes.includes(`- ${note}`), note);
    assert.equal(notes.trimEnd().split("\n").length, LIMITS_NOTES.length + 2);
  });

  it("omits the warning when nothing was skipped or the cache predates skipped, but keeps Notes", () => {
    for (const s of [skipped(0, 5), undefined]) {
      const plain = buildMarkdownReport(data({ skipped: s }));
      assert.doesNotMatch(plain, /Warning: packages not checked/);
      assert.match(plain, /## Notes/);
    }
  });

  it("explains an empty worklist with skipped packages instead of leaving the summary blank", () => {
    const empty = buildMarkdownReport(data({ worklist: [], skipped: skipped(3, 3, { "no-lockfile": 3 }) }));
    assert.match(empty, /- No packages could be checked, so there is nothing to report\./);
    const partial = buildMarkdownReport(data({ worklist: [], skipped: skipped(1, 3, { "no-lockfile": 1 }) }));
    assert.match(partial, /- Nothing to report for the packages that could be checked\./);
    assert.doesNotMatch(buildMarkdownReport(data({ worklist: [] })), /nothing to report/i);
  });
});

describe("json report: supply-chain content", () => {
  it("carries skipped, notes, a compromised summary count and the new item fields", () => {
    const s = skipped(2, 7, { "no-lockfile": 2 });
    const report = JSON.parse(buildJsonReport(data({ skipped: s })));
    assert.deepEqual(report.skipped, s);
    assert.deepEqual(report.notes, LIMITS_NOTES);
    assert.deepEqual(report.summary, { total: 5, compromised: 1, security: 3, breaking: 0, deprecation: 0, minor: 1 });
    assert.equal(report.worklist[0].category, "compromised");
    assert.deepEqual(report.worklist[0].safeVersions.lastKnownGood, { version: "4.0.0" });
    assert.deepEqual(report.worklist[0].advisoryIds, ["MAL-2025-47141"]);
    assert.equal(report.worklist[1].fixedVersion, "4.18.0");
    assert.equal(report.worklist[2].fixNeedsMajorUpgrade, true);
    assert.equal(report.worklist[3].noFixPublished, true);
  });

  it("writes skipped as null when absent (older cache) and still has notes", () => {
    const report = JSON.parse(buildJsonReport(data()));
    assert.equal(report.skipped, null);
    assert.ok(Array.isArray(report.notes) && report.notes.length > 0);
  });
});
