import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CliError } from "../../lib/errors.ts";
import type { WorklistItem } from "../../scan/types.ts";
import { buildJsonReport } from "../json.ts";
import { buildMarkdownReport } from "../markdown.ts";
import type { ReportData } from "../types.ts";
import { writeReportFile } from "../write.ts";

const worklist: WorklistItem[] = [
  { name: "minor-pkg", currentVersion: "1.0.0", latestVersion: "1.1.0", category: "minor", reason: "New release." },
  {
    name: "vuln-pkg",
    currentVersion: "1.0.0",
    latestVersion: "1.0.1",
    category: "security",
    severity: "critical",
    reason: "RCE",
    advisoryUrl: "https://osv.dev/X",
    affectedFiles: [{ path: "src/a.ts", confidence: "high" }],
    cooldown: { daysOld: 1 },
    prompt: "Upgrade it.\n```\ninner fence\n````\nmore",
  },
  { name: "ignored-pkg", currentVersion: "3.0.0", latestVersion: "3.0.0", category: "security", severity: "low", reason: "Old bug", ignored: true, affectedFiles: [] },
];

function data(overrides: Partial<ReportData> = {}): ReportData {
  return { scannedAt: "2026-10-13T10:00:00.000Z", repo: "/repo", driftlineVersion: "0.1.0", overflow: 0, worklist, ...overrides };
}

describe("buildJsonReport", () => {
  it("includes metadata, overflow, summary counts and the full worklist", () => {
    const text = buildJsonReport(data({ overflow: 4 }));
    assert.ok(text.endsWith("\n"));
    const parsed = JSON.parse(text);
    assert.equal(parsed.scannedAt, "2026-10-13T10:00:00.000Z");
    assert.equal(parsed.repo, "/repo");
    assert.equal(parsed.driftlineVersion, "0.1.0");
    assert.equal(parsed.overflow, 4);
    assert.deepEqual(parsed.summary, { total: 3, security: 2, breaking: 0, deprecation: 0, minor: 1 });
    assert.deepEqual(parsed.worklist, worklist);
  });

  it("reports overflow 0 and an empty summary for an empty worklist", () => {
    const parsed = JSON.parse(buildJsonReport(data({ worklist: [] })));
    assert.equal(parsed.overflow, 0);
    assert.deepEqual(parsed.summary, { total: 0, security: 0, breaking: 0, deprecation: 0, minor: 0 });
  });
});

describe("buildMarkdownReport", () => {
  it("renders the header, summary and category sections in rank order with continuous numbering", () => {
    const md = buildMarkdownReport(data());
    assert.match(md, /^# Driftline report/);
    assert.match(md, /- Repo: `\/repo`/);
    assert.match(md, /- Scanned: 2026-10-13T10:00:00\.000Z/);
    assert.match(md, /- Driftline: v0\.1\.0/);
    assert.match(md, /## Summary\n\n- 2 security fixes\n- 1 minor \/ feature update/);
    const security = md.indexOf("## Security fixes (2)");
    const minor = md.indexOf("## Minor / feature updates (1)");
    assert.ok(security > -1 && minor > security);
    assert.match(md, /### 1\. vuln-pkg \[CRITICAL\]/);
    assert.match(md, /### 2\. ignored-pkg \[LOW\]/);
    assert.match(md, /### 3\. minor-pkg/);
    assert.ok(!md.includes("## Breaking changes"));
  });

  it("renders versions, details and links", () => {
    const md = buildMarkdownReport(data());
    assert.match(md, /`1\.0\.0` -> `1\.0\.1`/);
    assert.match(md, /- Affected files:\n {2}- `src\/a\.ts` \(high confidence\)/);
    assert.match(md, /- Cooldown: released 1 day ago, consider waiting/);
    assert.match(md, /- Advisory: https:\/\/osv\.dev\/X/);
    assert.match(md, /- Affected files: none detected/);
  });

  it("marks an ignored advisory item instead of showing a version arrow", () => {
    const md = buildMarkdownReport(data());
    assert.match(md, /`3\.0\.0` \(on your ignore list; shown because of this advisory\)/);
    assert.doesNotMatch(md, /`3\.0\.0` -> `3\.0\.0`/);
  });

  it("wraps agent prompts in a fence longer than any backtick run inside", () => {
    const md = buildMarkdownReport(data());
    assert.match(md, /Agent prompt:\n\n`````text\nUpgrade it\./);
    assert.match(md, /more\n`````\n/);
  });

  it("uses a plain 3-backtick fence when the prompt has no backticks", () => {
    const md = buildMarkdownReport(data({ worklist: [{ ...worklist[0], category: "breaking", prompt: "plain" }] }));
    assert.match(md, /```text\nplain\n```/);
  });

  it("adds a '+N more' line only when items were capped", () => {
    assert.match(buildMarkdownReport(data({ overflow: 7 })), /- \+7 more not shown/);
    assert.doesNotMatch(buildMarkdownReport(data({ overflow: 0 })), /more not shown/);
  });

  it("renders just the header and summary for an empty worklist", () => {
    const md = buildMarkdownReport(data({ worklist: [] }));
    assert.match(md, /## Summary/);
    assert.doesNotMatch(md, /^### /m);
  });
});

describe("writeReportFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lr-write-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const when = new Date(2026, 9, 13, 9, 5, 3); // local time

  it("writes a timestamped name with the right extension and returns the absolute path", () => {
    const json = writeReportFile("{}", "json", dir, when);
    const md = writeReportFile("# x", "markdown", dir, when);
    assert.equal(json, join(dir, "driftline-2026-10-13T09-05-03.json"));
    assert.equal(md, join(dir, "driftline-2026-10-13T09-05-03.md"));
    assert.equal(readFileSync(json, "utf8"), "{}");
    assert.equal(readFileSync(md, "utf8"), "# x");
  });

  it("never overwrites: same-second collisions get a numeric suffix", () => {
    const first = writeReportFile("one", "json", dir, when);
    const second = writeReportFile("two", "json", dir, when);
    const third = writeReportFile("three", "json", dir, when);
    assert.equal(second, join(dir, "driftline-2026-10-13T09-05-03-1.json"));
    assert.equal(third, join(dir, "driftline-2026-10-13T09-05-03-2.json"));
    assert.equal(readFileSync(first, "utf8"), "one");
    assert.equal(readFileSync(second, "utf8"), "two");
  });

  it("creates the directory (nested) when missing", () => {
    const target = join(dir, "a", "b");
    const path = writeReportFile("{}", "json", target, when);
    assert.equal(readFileSync(path, "utf8"), "{}");
  });

  it("resolves relative directories against the cwd", () => {
    const original = process.cwd();
    process.chdir(dir);
    try {
      const path = writeReportFile("{}", "json", "rel-out", when);
      assert.equal(path, join(process.cwd(), "rel-out", "driftline-2026-10-13T09-05-03.json"));
    } finally {
      process.chdir(original);
    }
  });

  it("throws a CliError when the target is a file, not a directory", () => {
    const file = join(dir, "afile");
    writeFileSync(file, "x");
    assert.throws(() => writeReportFile("{}", "json", file, when), (err) => {
      assert.ok(err instanceof CliError);
      assert.match(err.message, /is a file, not a directory/);
      return true;
    });
  });

  it("throws a CliError when the directory cannot be created", () => {
    const file = join(dir, "afile");
    writeFileSync(file, "x");
    assert.throws(() => writeReportFile("{}", "json", join(file, "sub"), when), (err) => {
      assert.ok(err instanceof CliError);
      return true;
    });
  });
});
