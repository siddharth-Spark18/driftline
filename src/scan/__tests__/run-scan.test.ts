import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { runScan } from "../index.ts";
import { loadPublishCache } from "../publish-cache.ts";
import type { InstalledPackage } from "../types.ts";

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

function pkg(name: string, installedVersion: string | null = "1.0.0"): InstalledPackage {
  return { name, declaredRange: "^1.0.0", dev: false, installedVersion };
}

interface FakeOptions {
  /** name -> latest version */
  latest: Record<string, string>;
  /** name -> { version: publishTime } served on the full packument */
  times?: Record<string, Record<string, string>>;
  /** name -> OSV vulns */
  osv?: Record<string, unknown[]>;
  /** packuments that answer with an error */
  failPackument?: string[];
}

/** Fake registry + OSV that records every URL it was asked for. */
function fakeFetch(options: FakeOptions) {
  const calls: string[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://registry.npmjs.org/")) {
      const path = decodeURIComponent(url.slice("https://registry.npmjs.org/".length));
      const isLatest = path.endsWith("/latest");
      const name = isLatest ? path.slice(0, -"/latest".length) : path;
      if (isLatest) {
        const version = options.latest[name];
        return version ? ({ ok: true, json: async () => ({ version }) } as Response) : ({ ok: false } as Response);
      }
      if (options.failPackument?.includes(name)) return { ok: false } as Response;
      return { ok: true, json: async () => ({ time: options.times?.[name] ?? {} }) } as Response;
    }
    if (url === "https://api.osv.dev/v1/query") {
      const body = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ vulns: options.osv?.[body.package.name] ?? [] }) } as Response;
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  const registry = (kind: "latest" | "packument", name?: string) =>
    calls.filter((u) => u.startsWith("https://registry.npmjs.org/") && u.endsWith("/latest") === (kind === "latest") && (!name || u.includes(name)));
  return { impl, calls, registry };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lr-runscan-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runScan: ignorePackages", () => {
  const vuln = [{ id: "OSV-9", summary: "Bad thing", database_specific: { severity: "high" }, references: [{ type: "ADVISORY", url: "https://osv.dev/OSV-9" }] }];

  it("hides ignored packages and counts them, skipping their registry lookups", async () => {
    const fake = fakeFetch({ latest: { keep: "1.1.0", "@types/node": "2.0.0", "left-pad": "2.0.0" } });
    const result = await runScan([pkg("keep"), pkg("@types/node"), pkg("left-pad")], {
      fetchImpl: fake.impl,
      ignorePackages: ["@types/*", "left-pad"],
    });
    assert.deepEqual(result.items.map((i) => i.name), ["keep"]);
    assert.equal(result.ignored, 2);
    assert.equal(result.overflow, 0);
    assert.equal(fake.registry("latest", "keep").length, 1);
    assert.equal(fake.calls.filter((u) => u.includes("left-pad") || u.includes("types")).length, 0);
    // Ignored packages are still checked for advisories only.
    assert.equal(fake.calls.filter((u) => u === "https://api.osv.dev/v1/query").length, 3);
  });

  it("still shows an ignored package that has an advisory, marked ignored and not counted as hidden", async () => {
    const fake = fakeFetch({ latest: {}, osv: { "left-pad": vuln } });
    const result = await runScan([pkg("left-pad", "1.3.0")], { fetchImpl: fake.impl, ignorePackages: ["left-pad"] });
    assert.equal(result.items.length, 1);
    assert.equal(result.ignored, 0);
    const [item] = result.items;
    assert.equal(item.ignored, true);
    assert.equal(item.category, "security");
    assert.equal(item.severity, "high");
    assert.equal(item.advisoryUrl, "https://osv.dev/OSV-9");
    assert.equal(item.currentVersion, "1.3.0");
    // No registry traffic at all for an ignored package, not even a publish-time lookup.
    assert.equal(fake.calls.filter((u) => u.startsWith("https://registry.npmjs.org/")).length, 0);
  });

  it("builds no upgrade prompt for an ignored advisory item but does detect usage", async () => {
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    writeFileSync(join(repo, "a.ts"), `import "left-pad";\n`);
    const fake = fakeFetch({ latest: {}, osv: { "left-pad": vuln } });
    const { items } = await runScan([pkg("left-pad")], { fetchImpl: fake.impl, ignorePackages: ["left-pad"], repoPath: repo });
    assert.equal(items[0].prompt, undefined);
    assert.equal(items[0].usageDetected, true);
  });

  it("ignores nothing by default", async () => {
    const fake = fakeFetch({ latest: { a: "1.1.0" } });
    const result = await runScan([pkg("a")], { fetchImpl: fake.impl });
    assert.equal(result.items.length, 1);
    assert.equal(result.ignored, 0);
  });

  it("does not count an ignored package without a resolved version as an advisory item", async () => {
    const fake = fakeFetch({ latest: {} });
    const result = await runScan([pkg("left-pad", null)], { fetchImpl: fake.impl, ignorePackages: ["left-pad"] });
    assert.deepEqual(result.items, []);
  });
});

describe("runScan: cap before publish-time lookup", () => {
  it("only fetches publish times for items that survive the cap", async () => {
    const fake = fakeFetch({
      latest: { a: "1.1.0", b: "1.1.0", c: "1.1.0", d: "1.1.0" },
      times: { a: { "1.1.0": iso(30) } },
    });
    const result = await runScan([pkg("a"), pkg("b"), pkg("c"), pkg("d")], { fetchImpl: fake.impl, maxItems: 1 });
    assert.deepEqual(result.items.map((i) => i.name), ["a"]);
    assert.equal(result.overflow, 3);
    assert.equal(fake.registry("packument").length, 1);
    assert.match(fake.registry("packument")[0], /\/a$/);
    assert.equal(result.items[0].releasedAt, new Date(iso(30)).toISOString());
  });

  it("is uncapped with zero overflow when maxItems is omitted", async () => {
    const fake = fakeFetch({ latest: { a: "1.1.0", b: "1.1.0" } });
    const result = await runScan([pkg("a"), pkg("b")], { fetchImpl: fake.impl });
    assert.equal(result.items.length, 2);
    assert.equal(result.overflow, 0);
    assert.equal(fake.registry("packument").length, 2);
  });

  it("flags cooldown only on shown items", async () => {
    const fake = fakeFetch({ latest: { a: "1.1.0" }, times: { a: { "1.1.0": iso(1) } } });
    const { items } = await runScan([pkg("a")], { fetchImpl: fake.impl, cooldownDays: 3 });
    assert.deepEqual(items[0].cooldown, { daysOld: 1 });
  });
});

describe("runScan: publish-time disk cache", () => {
  it("serves a cache hit without fetching the packument", async () => {
    const cachePath = join(tmp, "cache", "publish-times.json");
    mkdirSync(join(tmp, "cache"));
    writeFileSync(cachePath, JSON.stringify({ "a@1.1.0": iso(1) }));
    const fake = fakeFetch({ latest: { a: "1.1.0" } });
    const { items } = await runScan([pkg("a")], { fetchImpl: fake.impl, publishCachePath: cachePath, cooldownDays: 3 });
    assert.equal(fake.registry("packument").length, 0);
    assert.equal(items[0].releasedAt, iso(1));
    assert.deepEqual(items[0].cooldown, { daysOld: 1 });
  });

  it("writes fetched times to the cache so a second run makes no packument request", async () => {
    const cachePath = join(tmp, "cache", "publish-times.json");
    const times = { a: { "1.1.0": iso(10) } };
    const first = fakeFetch({ latest: { a: "1.1.0" }, times });
    await runScan([pkg("a")], { fetchImpl: first.impl, publishCachePath: cachePath });
    assert.equal(first.registry("packument").length, 1);
    assert.deepEqual(loadPublishCache(cachePath), { "a@1.1.0": new Date(iso(10)).toISOString() });

    const second = fakeFetch({ latest: { a: "1.1.0" }, times });
    const { items } = await runScan([pkg("a")], { fetchImpl: second.impl, publishCachePath: cachePath });
    assert.equal(second.registry("packument").length, 0);
    assert.equal(items[0].releasedAt, new Date(iso(10)).toISOString());
  });

  it("does not cache failures, so they are retried next run", async () => {
    const cachePath = join(tmp, "cache", "publish-times.json");
    const failing = fakeFetch({ latest: { a: "1.1.0", b: "1.1.0" }, times: { b: { "1.1.0": iso(5) } }, failPackument: ["a"] });
    const { items } = await runScan([pkg("a"), pkg("b")], { fetchImpl: failing.impl, publishCachePath: cachePath });
    assert.equal(items.find((i) => i.name === "a")?.releasedAt, undefined);
    assert.deepEqual(Object.keys(loadPublishCache(cachePath)), ["b@1.1.0"]);

    const retry = fakeFetch({ latest: { a: "1.1.0", b: "1.1.0" }, times: { a: { "1.1.0": iso(7) } } });
    await runScan([pkg("a"), pkg("b")], { fetchImpl: retry.impl, publishCachePath: cachePath });
    assert.equal(retry.registry("packument").length, 1);
    assert.match(retry.registry("packument")[0], /\/a$/);
  });

  it("does not cache a version missing from the time map or an unparseable time", async () => {
    const cachePath = join(tmp, "publish-times.json");
    const fake = fakeFetch({ latest: { a: "1.1.0", b: "1.1.0" }, times: { a: {}, b: { "1.1.0": "garbage" } } });
    await runScan([pkg("a"), pkg("b")], { fetchImpl: fake.impl, publishCachePath: cachePath });
    assert.equal(existsSync(cachePath), false);
  });

  it("ignores a corrupt cache file and repairs it", async () => {
    const cachePath = join(tmp, "publish-times.json");
    writeFileSync(cachePath, "{{{ not json");
    const fake = fakeFetch({ latest: { a: "1.1.0" }, times: { a: { "1.1.0": iso(9) } } });
    const { items } = await runScan([pkg("a")], { fetchImpl: fake.impl, publishCachePath: cachePath });
    assert.equal(items[0].releasedAt, new Date(iso(9)).toISOString());
    assert.deepEqual(JSON.parse(readFileSync(cachePath, "utf8")), { "a@1.1.0": new Date(iso(9)).toISOString() });
  });

  it("survives an unwritable cache location", async () => {
    writeFileSync(join(tmp, "blocker"), "x");
    const fake = fakeFetch({ latest: { a: "1.1.0" }, times: { a: { "1.1.0": iso(9) } } });
    const { items } = await runScan([pkg("a")], { fetchImpl: fake.impl, publishCachePath: join(tmp, "blocker", "c.json") });
    assert.equal(items.length, 1);
    assert.ok(items[0].releasedAt);
  });

  it("works without a cache path (no disk access)", async () => {
    const fake = fakeFetch({ latest: { a: "1.1.0" }, times: { a: { "1.1.0": iso(9) } } });
    const { items } = await runScan([pkg("a")], { fetchImpl: fake.impl });
    assert.ok(items[0].releasedAt);
  });

  it("preserves existing entries for other packages when saving", async () => {
    const cachePath = join(tmp, "publish-times.json");
    writeFileSync(cachePath, JSON.stringify({ "other@9.9.9": "2026-01-01T00:00:00.000Z" }));
    const fake = fakeFetch({ latest: { a: "1.1.0" }, times: { a: { "1.1.0": iso(9) } } });
    await runScan([pkg("a")], { fetchImpl: fake.impl, publishCachePath: cachePath });
    assert.deepEqual(Object.keys(loadPublishCache(cachePath)).sort(), ["a@1.1.0", "other@9.9.9"]);
  });
});
