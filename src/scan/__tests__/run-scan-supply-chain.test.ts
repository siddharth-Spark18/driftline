import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { eventStreamGhsa, lodashVuln, minimistVuln, tinycolorMal, uaParserGhsa } from "../../__tests__/helpers/osv-fixtures.ts";
import { runScan } from "../index.ts";
import type { InstalledPackage, SkipReason } from "../types.ts";

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function pkg(name: string, installedVersion: string | null = "1.0.0", skipReason?: SkipReason): InstalledPackage {
  return { name, declaredRange: "^1.0.0", dev: false, installedVersion, ...(skipReason ? { skipReason } : {}) };
}

interface FakeOptions {
  latest: Record<string, string>;
  /** name -> version list served on the full packument */
  versions?: Record<string, string[]>;
  times?: Record<string, Record<string, string>>;
  osv?: Record<string, unknown[]>;
  failPackument?: string[];
}

function fakeFetch(options: FakeOptions) {
  const calls: string[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://registry.npmjs.org/")) {
      const path = decodeURIComponent(url.slice("https://registry.npmjs.org/".length));
      if (path.endsWith("/latest")) {
        const version = options.latest[path.slice(0, -"/latest".length)];
        return version ? ({ ok: true, json: async () => ({ version }) } as Response) : ({ ok: false } as Response);
      }
      if (options.failPackument?.includes(path)) return { ok: false } as Response;
      const list = options.versions?.[path];
      return {
        ok: true,
        json: async () => ({
          time: options.times?.[path] ?? {},
          ...(list ? { versions: Object.fromEntries(list.map((v) => [v, {}])) } : {}),
        }),
      } as Response;
    }
    if (url === "https://api.osv.dev/v1/query") {
      const body = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ vulns: options.osv?.[body.package.name] ?? [] }) } as Response;
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  const packuments = (name: string) =>
    calls.filter((u) => u.startsWith("https://registry.npmjs.org/") && !u.endsWith("/latest") && decodeURIComponent(u).endsWith(`/${name}`));
  return { impl, calls, packuments };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lr-runscan-sc-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runScan: skipped summary", () => {
  it("counts unresolved packages by reason, with the total of all packages considered", async () => {
    const fake = fakeFetch({ latest: { ok: "1.0.0" } });
    const { items, skipped } = await runScan(
      [
        pkg("ok"),
        pkg("a", null, "no-lockfile"),
        pkg("b", null, "unsupported-lockfile"),
        pkg("c", null, "unsupported-lockfile"),
        pkg("d", null, "lockfile-unreadable"),
        pkg("e", null, "not-in-lockfile"),
      ],
      { fetchImpl: fake.impl },
    );
    assert.deepEqual(items, []);
    assert.deepEqual(skipped, {
      count: 5,
      total: 6,
      reasons: { "no-lockfile": 1, "unsupported-lockfile": 2, "lockfile-unreadable": 1, "not-in-lockfile": 1 },
    });
    // Skipped packages cause no requests.
    assert.ok(fake.calls.every((u) => !/\/(a|b|c|d|e)(\/latest)?$/.test(u)));
  });

  it("defaults a missing skipReason to no-lockfile, and reports zeros when everything resolved", async () => {
    const fake = fakeFetch({ latest: { x: "1.0.0" } });
    const none = await runScan([pkg("x")], { fetchImpl: fake.impl });
    assert.deepEqual(none.skipped, { count: 0, total: 1, reasons: { "no-lockfile": 0, "unsupported-lockfile": 0, "lockfile-unreadable": 0, "not-in-lockfile": 0 } });
    const legacy = await runScan([pkg("y", null)], { fetchImpl: fake.impl });
    assert.equal(legacy.skipped.reasons["no-lockfile"], 1);
    const empty = await runScan([], { fetchImpl: fake.impl });
    assert.equal(empty.skipped.total, 0);
    assert.equal(empty.skipped.count, 0);
  });
});

describe("runScan: compromised items", () => {
  it("builds a compromised item with safe versions from the registry version list", async () => {
    const fake = fakeFetch({
      latest: { "@ctrl/tinycolor": "4.2.0" },
      versions: { "@ctrl/tinycolor": ["4.0.0", "4.1.0", "4.1.1", "4.1.2", "4.2.0"] },
      times: { "@ctrl/tinycolor": { "4.2.0": iso(40) } },
      osv: { "@ctrl/tinycolor": [tinycolorMal] },
    });
    const { items } = await runScan([pkg("@ctrl/tinycolor", "4.1.1")], { fetchImpl: fake.impl });
    assert.equal(items.length, 1);
    const [evil] = items;
    assert.equal(evil.category, "compromised");
    assert.equal(evil.currentVersion, "4.1.1");
    assert.equal(evil.latestVersion, "4.2.0");
    assert.equal(evil.reason, "Malicious code in @ctrl/tinycolor (npm)");
    assert.deepEqual(evil.advisoryIds, ["MAL-2025-47141"]);
    assert.equal(evil.otherAdvisoryCount, 0);
    assert.equal(evil.fixedVersion, undefined);
    assert.equal(evil.safeVersions?.newestNotListedBad?.version, "4.2.0");
    // The real record's range starts at the first bad version (introduced 4.1.1), so 4.1.0 is the last known-good.
    assert.equal(evil.safeVersions?.lastKnownGood?.version, "4.1.0");
    assert.equal(evil.releasedAt, iso(40));
    // The version list doubles as the publish-time lookup: one packument request only.
    assert.equal(fake.packuments("tinycolor").length, 1);
  });

  it("fetches the version list only for compromised items", async () => {
    const fake = fakeFetch({
      latest: { evil: "1.1.0", lodash: "4.18.0", plain: "1.1.0" },
      versions: { evil: ["1.0.0", "1.0.1", "1.1.0"] },
      times: { evil: { "1.1.0": iso(30) } },
      osv: { evil: [{ id: "MAL-1", summary: "bad", affected: [{ package: { name: "evil", ecosystem: "npm" }, versions: ["1.0.1"] }] }], lodash: [lodashVuln] },
    });
    // maxItems 1 keeps only the compromised item (publish-time lookups for cut items never happen).
    const result = await runScan([pkg("evil", "1.0.1"), pkg("lodash", "4.17.15"), pkg("plain")], { fetchImpl: fake.impl, maxItems: 1 });
    assert.deepEqual(result.items.map((i) => i.name), ["evil", "lodash"]);
    const lodash = result.items[1];
    assert.equal(lodash.safeVersions, undefined);
    assert.equal(result.items[0].safeVersions?.lastKnownGood?.version, "1.0.0");
    assert.equal(fake.packuments("evil").length, 1);
    // lodash only gets its publish-time lookup; it is never treated as a version-list fetch.
    assert.equal(fake.packuments("lodash").length, 1);
    assert.equal(fake.packuments("plain").length, 0);
  });

  it("still shows the card when the version list can't be fetched", async () => {
    const fake = fakeFetch({ latest: { evil: "1.1.0" }, osv: { evil: [{ id: "MAL-1", summary: "bad" }] }, failPackument: ["evil"] });
    const { items } = await runScan([pkg("evil", "1.0.1")], { fetchImpl: fake.impl });
    assert.equal(items.length, 1);
    assert.equal(items[0].category, "compromised");
    assert.deepEqual(items[0].safeVersions, { lookupFailed: true });
    assert.equal(items[0].releasedAt, undefined);
  });

  it("reports lookupFailed when the packument has no versions field", async () => {
    const fake = fakeFetch({ latest: { evil: "1.1.0" }, osv: { evil: [{ id: "MAL-1", summary: "bad" }] } });
    const { items } = await runScan([pkg("evil", "1.0.1")], { fetchImpl: fake.impl });
    assert.deepEqual(items[0].safeVersions, { lookupFailed: true });
  });

  it("still shows a compromised item when the registry has no latest for it", async () => {
    const fake = fakeFetch({ latest: {}, osv: { evil: [{ id: "MAL-1", summary: "bad" }] }, versions: { evil: ["1.0.0", "1.0.1"] } });
    const { items } = await runScan([pkg("evil", "1.0.1")], { fetchImpl: fake.impl });
    assert.equal(items.length, 1);
    assert.equal(items[0].category, "compromised");
    assert.equal(items[0].latestVersion, "1.0.1");
    // A registry miss for an ordinary vulnerability still drops the item.
    const plain = await runScan([pkg("lodash", "4.17.15")], { fetchImpl: fakeFetch({ latest: {}, osv: { lodash: [lodashVuln] } }).impl });
    assert.deepEqual(plain.items, []);
  });

  it("lets compromised win over ordinary advisories and counts the others", async () => {
    const fake = fakeFetch({
      latest: { "ua-parser-js": "2.0.0" },
      osv: { "ua-parser-js": [uaParserGhsa, { id: "GHSA-other-1", summary: "ReDoS", database_specific: { severity: "moderate" } }, { id: "GHSA-other-2", summary: "DoS" }] },
    });
    const { items } = await runScan([pkg("ua-parser-js", "0.7.29")], { fetchImpl: fake.impl });
    assert.equal(items.length, 1);
    assert.equal(items[0].category, "compromised");
    assert.deepEqual(items[0].advisoryIds, ["GHSA-pjwm-rvh2-c87w"]);
    assert.equal(items[0].otherAdvisoryCount, 2);
    assert.equal(items[0].reason, "Embedded malware in ua-parser-js");
  });

  it("classifies a CWE-506 GHSA for event-stream as compromised", async () => {
    const fake = fakeFetch({ latest: { "event-stream": "4.0.1" }, osv: { "event-stream": [eventStreamGhsa] } });
    const { items } = await runScan([pkg("event-stream", "3.3.6")], { fetchImpl: fake.impl });
    assert.equal(items[0].category, "compromised");
  });

  it("shows an ignored compromised package, flagged ignored, and does not count it as ignored", async () => {
    const fake = fakeFetch({ latest: { evil: "1.1.0" }, osv: { evil: [{ id: "MAL-1", summary: "bad" }] }, versions: { evil: ["1.0.0", "1.0.1", "1.1.0"] } });
    const result = await runScan([pkg("evil", "1.0.1"), pkg("other")], { fetchImpl: fake.impl, ignorePackages: ["evil", "other"] });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].category, "compromised");
    assert.equal(result.items[0].ignored, true);
    assert.equal(result.ignored, 1);
    // An ignored package skips /latest; the latest shown is the installed version.
    assert.equal(result.items[0].latestVersion, "1.0.1");
    assert.deepEqual(fake.calls.filter((u) => u.endsWith("/evil/latest")), []);
  });

  it("builds the compromised prompt for an ignored compromised item but no prompt for an ignored security item", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
    const fake = fakeFetch({
      latest: {},
      osv: { evil: [{ id: "MAL-1", summary: "bad" }], lodash: [lodashVuln] },
      versions: { evil: ["1.0.0", "1.0.1"] },
    });
    const { items } = await runScan([pkg("evil", "1.0.1"), pkg("lodash", "4.17.15")], { fetchImpl: fake.impl, repoPath: tmp, ignorePackages: ["evil", "lodash"] });
    const evil = items.find((i) => i.name === "evil")!;
    const lodash = items.find((i) => i.name === "lodash")!;
    assert.match(evil.prompt ?? "", /npm ci/);
    assert.equal(lodash.prompt, undefined);
    assert.equal(lodash.ignored, true);
    assert.equal(lodash.fixedVersion, "4.18.0");
  });

  it("keeps compromised and security items when the cap would cut them, ranked first", async () => {
    const fake = fakeFetch({
      latest: { evil: "1.1.0", lodash: "4.18.0", a: "1.1.0", b: "2.0.0" },
      osv: { evil: [{ id: "MAL-1", summary: "bad" }], lodash: [lodashVuln] },
    });
    const result = await runScan([pkg("a"), pkg("b"), pkg("evil", "1.0.1"), pkg("lodash", "4.17.15")], { fetchImpl: fake.impl, maxItems: 1 });
    assert.deepEqual(result.items.map((i) => i.name), ["evil", "lodash"]);
    assert.equal(result.overflow, 2);
  });
});

describe("runScan: fix versions on security items", () => {
  it("shows the in-line fix beside latest for a lodash-like package", async () => {
    const fake = fakeFetch({ latest: { lodash: "5.0.0" }, osv: { lodash: [lodashVuln] } });
    const { items } = await runScan([pkg("lodash", "4.17.15")], { fetchImpl: fake.impl });
    assert.equal(items[0].category, "security");
    assert.equal(items[0].fixedVersion, "4.18.0");
    assert.equal(items[0].fixNeedsMajorUpgrade, undefined);
    assert.equal(items[0].latestVersion, "5.0.0");
    assert.deepEqual(items[0].advisoryIds, ["GHSA-lodash-0001"]);
  });

  it("flags a fix outside the 0.x line as needing a major upgrade", async () => {
    const fake = fakeFetch({ latest: { minimist: "1.2.8" }, osv: { minimist: [minimistVuln] } });
    const { items } = await runScan([pkg("minimist", "0.0.8")], { fetchImpl: fake.impl });
    assert.equal(items[0].fixedVersion, "0.2.4");
    assert.equal(items[0].fixNeedsMajorUpgrade, true);
    assert.equal(items[0].latestVersion, "1.2.8");
  });

  it("marks noFixPublished and leaves out the fix for an advisory without a fixed version", async () => {
    const open = { id: "GHSA-open", summary: "Unfixed", database_specific: { severity: "low" }, affected: [{ package: { name: "p", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }] };
    const fake = fakeFetch({ latest: { p: "1.5.0" }, osv: { p: [open] } });
    const { items } = await runScan([pkg("p")], { fetchImpl: fake.impl });
    assert.equal(items[0].noFixPublished, true);
    assert.equal(items[0].fixedVersion, undefined);
  });

  it("makes no fix claim for advisories without affected data", async () => {
    const fake = fakeFetch({ latest: { p: "1.5.0" }, osv: { p: [{ id: "OSV-1", summary: "s" }] } });
    const { items } = await runScan([pkg("p")], { fetchImpl: fake.impl });
    assert.equal(items[0].category, "security");
    assert.equal(items[0].fixedVersion, undefined);
    assert.equal(items[0].noFixPublished, undefined);
  });

  it("does not crash on a prerelease installed version", async () => {
    const fake = fakeFetch({ latest: { lodash: "5.0.0" }, osv: { lodash: [lodashVuln] } });
    const { items } = await runScan([pkg("lodash", "4.17.15-beta.1")], { fetchImpl: fake.impl });
    assert.equal(items[0].category, "security");
    assert.equal(items[0].fixedVersion, "4.18.0");
  });
});
