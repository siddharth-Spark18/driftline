import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDigest } from "../terminal.ts";
import type { WorklistItem } from "../../scan/types.ts";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

function item(overrides: Partial<WorklistItem> = {}): WorklistItem {
  return { name: "foo", currentVersion: "1.0.0", latestVersion: "2.0.0", category: "breaking", reason: "Big change.", ...overrides };
}

const mixed: WorklistItem[] = [
  item({ name: "vuln", category: "security", severity: "high", reason: "RCE", advisoryUrl: "https://osv.dev/X" }),
  item({ name: "major", category: "breaking" }),
  item({ name: "old", category: "deprecation", reason: "Deprecated." }),
  item({ name: "tiny", category: "minor", reason: "New." }),
];

describe("renderDigest: color on/off", () => {
  it("uses plain ASCII glyphs and no escapes when color is off", () => {
    const out = renderDigest(mixed, { color: false, width: 80 });
    assert.doesNotMatch(out, /\x1b\[/);
    assert.match(out, /^\+-+\+$/m);
    assert.match(out, /^\| \* Driftline digest +\|$/m);
    assert.match(out, /1\.0\.0 -> 2\.0\.0/);
    assert.doesNotMatch(out, /[╭╮╰╯│─●◆→↗◷✖▲▼█…]/);
  });

  it("uses unicode box drawing and escapes when color is on", () => {
    const out = renderDigest(mixed, { color: true, width: 80 });
    assert.match(out, /\x1b\[/);
    assert.match(out, /╭─+╮/);
    assert.match(out, /◆ Driftline digest/);
    assert.match(out, /→/);
  });

  it("keeps the same visible layout in both modes (line widths match)", () => {
    const plain = renderDigest(mixed, { color: false, width: 60 }).split("\n");
    const boxed = renderDigest(mixed, { color: true, width: 60 }).split("\n").map(strip);
    // Card and banner lines are exactly `width` wide in either mode.
    for (const line of plain.filter((l) => l.startsWith("+") || l.startsWith("|"))) assert.equal(line.length, 60, line);
    for (const line of boxed.filter((l) => /^[╭╰│]/.test(l))) assert.equal([...line].length, 60, line);
  });

  it("respects NO_COLOR when color is not given explicitly", () => {
    const original = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      assert.doesNotMatch(renderDigest(mixed, { width: 80 }), /\x1b\[/);
    } finally {
      if (original === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = original;
    }
  });
});

describe("renderDigest: layout", () => {
  it("shows a banner with the repo label, truncating a long path from the start", () => {
    const out = renderDigest([item()], { color: false, width: 40, repoLabel: "/very/long/path/to/some/deeply/nested/project" });
    assert.match(out, /^\| \.\.\.\S+ +\|$/m);
    assert.ok(out.split("\n").every((l) => l.length <= 40));
  });

  it("clamps the width into a readable range", () => {
    const narrow = renderDigest([item()], { color: false, width: 5 }).split("\n")[0];
    const wide = renderDigest([item()], { color: false, width: 500 }).split("\n")[0];
    assert.equal(narrow.length, 40);
    assert.equal(wide.length, 100);
  });

  it("wraps long reasons and hard-breaks long URLs within the card on narrow terminals", () => {
    const url = `https://example.com/${"a".repeat(120)}`;
    const out = renderDigest([item({ reason: "word ".repeat(40), releaseUrl: url })], { color: false, width: 40 });
    for (const line of out.split("\n")) assert.ok(line.length <= 40, `too wide: ${line}`);
    assert.equal(out.replace(/[\s|]/g, "").includes("a".repeat(120)), true);
  });

  it("renders the summary bar at full width with each category represented", () => {
    const lines = renderDigest(mixed, { color: false, width: 60 }).split("\n");
    const bar = lines.find((l) => /^#[#=+-]{59}$/.test(l));
    assert.ok(bar, "bar line");
    assert.ok(bar.includes("#") && bar.includes("=") && bar.includes("+") && bar.includes("-"));
    assert.ok(lines.some((l) => l.includes("* 1 security fix") && l.includes("* 1 breaking change")));
  });

  it("gives tiny categories at least one cell of the bar", () => {
    const many = Array.from({ length: 50 }, (_, i) => item({ name: `m${i}`, category: "minor" }));
    const out = renderDigest([...many, item({ category: "security" })], { color: false, width: 40 });
    const bar = out.split("\n").find((l) => /^[#-]{40}$/.test(l))!;
    assert.ok(bar.includes("#"));
  });

  it("wraps the legend onto more lines when it doesn't fit", () => {
    const out = renderDigest(mixed, { color: false, width: 40 });
    const legendLines = out.split("\n").filter((l) => l.startsWith("* "));
    assert.ok(legendLines.length >= 2);
  });

  it("puts badges on their own row when the title is too long", () => {
    const out = renderDigest([item({ name: "x".repeat(50) })], { color: false, width: 40 });
    assert.match(out, /^\| \[BREAKING\] +\|$/m);
  });

  it("shows severity badge only for security items and hides 'unknown'", () => {
    const out = renderDigest(mixed, { color: false, width: 100 });
    assert.match(out, /vuln +\[SECURITY\] \[HIGH\]/);
    assert.doesNotMatch(out, /\[BREAKING\] \[/);
  });

  it("shows affected-file counts, the no-usage note and the cooldown flag", () => {
    const out = renderDigest(
      [
        item({ name: "a", affectedFiles: [{ path: "x", confidence: "high" }] }),
        item({ name: "b", affectedFiles: [] }),
        item({ name: "c", affectedFiles: [{ path: "x", confidence: "high" }, { path: "y", confidence: "low" }], cooldown: { daysOld: 0 } }),
      ],
      { color: false, width: 100 },
    );
    assert.match(out, /1 affected file\b/);
    assert.match(out, /2 affected files/);
    assert.match(out, /no usage detected/);
    assert.match(out, /~ released today, consider waiting/);
  });

  it("prefers the advisory link over the release link", () => {
    const out = renderDigest([item({ advisoryUrl: "https://adv", releaseUrl: "https://rel" })], { color: false, width: 80 });
    assert.match(out, /-> https:\/\/adv/);
    assert.doesNotMatch(out, /https:\/\/rel/);
  });
});

describe("renderDigest: overflow and ignored lines", () => {
  it("shows '+N more' only when something was cut", () => {
    assert.match(renderDigest([item()], { color: false, overflow: 4 }), /\+4 more \(raise the cap with --limit or preferences\.maxItems\)/);
    assert.doesNotMatch(renderDigest([item()], { color: false, overflow: 0 }), /more/);
    assert.doesNotMatch(renderDigest([item()], { color: false }), /\+\d+ more/);
  });

  it("shows the 'N ignored' note on a populated digest (regression)", () => {
    const out = renderDigest([item()], { color: false, ignored: 3 });
    assert.match(out, /3 ignored \(preferences\.ignorePackages\)/);
    assert.ok(out.trimEnd().endsWith("3 ignored (preferences.ignorePackages)"));
  });

  it("shows the 'N ignored' note even when nothing else is reported", () => {
    const out = renderDigest([], { color: false, ignored: 2 });
    assert.match(out, /Nothing to report/);
    assert.match(out, /2 ignored/);
  });

  it("omits the note for 0 or undefined", () => {
    assert.doesNotMatch(renderDigest([item()], { color: false, ignored: 0 }), /ignored/);
    assert.doesNotMatch(renderDigest([], { color: false }), /ignored/);
  });

  it("renders an ignored advisory item without a version arrow and with a marker", () => {
    const out = renderDigest(
      [item({ name: "left-pad", category: "security", severity: "high", currentVersion: "1.3.0", latestVersion: "1.3.0", ignored: true, reason: "Bad" })],
      { color: false, width: 100 },
    );
    assert.match(out, /on your ignore list \(shown because of this advisory\)/);
    assert.doesNotMatch(out, /1\.3\.0 -> 1\.3\.0/);
    assert.match(out, /\| 1\.3\.0 +\|/);
  });

  it("lists the overflow line before the ignored note", () => {
    const out = renderDigest([item()], { color: false, overflow: 1, ignored: 1 });
    assert.ok(out.indexOf("+1 more") < out.indexOf("1 ignored"));
  });
});
