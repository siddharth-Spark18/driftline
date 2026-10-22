import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { lodashVuln, minimistVuln, tinycolorMal } from "./helpers/osv-fixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..");
const cliEntry = join(projectRoot, "src", "cli.ts");
const preload = join(here, "helpers", "mock-network.mjs");

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

let tmpHome: string;
let tmpCache: string;
let tmpRepo: string;
let tmpMisc: string;
let requestLog: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "lr-sc-home-"));
  tmpCache = mkdtempSync(join(tmpdir(), "lr-sc-cache-"));
  tmpRepo = mkdtempSync(join(tmpdir(), "lr-sc-repo-"));
  tmpMisc = mkdtempSync(join(tmpdir(), "lr-sc-misc-"));
  requestLog = join(tmpMisc, "requests.log");
  writeFileSync(requestLog, "");
});

afterEach(() => {
  for (const dir of [tmpHome, tmpCache, tmpRepo, tmpMisc]) rmSync(dir, { recursive: true, force: true });
});

function writeProject(deps: Record<string, string>, lock?: Record<string, string>, extraFiles: Record<string, string> = {}): void {
  writeFileSync(join(tmpRepo, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "node --test" }, dependencies: deps }));
  if (lock) {
    writeFileSync(
      join(tmpRepo, "package-lock.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "fixture", version: "1.0.0" }, ...Object.fromEntries(Object.entries(lock).map(([n, v]) => [`node_modules/${n}`, { version: v }])) },
      }),
    );
  }
  for (const [name, contents] of Object.entries(extraFiles)) writeFileSync(join(tmpRepo, name), contents);
}

function writeFixture(fixture: Record<string, unknown>): void {
  writeFileSync(join(tmpMisc, "fixture.json"), JSON.stringify(fixture));
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "--import", preload, cliEntry, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: tmpHome,
      XDG_CACHE_HOME: tmpCache,
      NO_COLOR: "1",
      GITHUB_TOKEN: "",
      DRIFTLINE_TEST_FIXTURE: join(tmpMisc, "fixture.json"),
      DRIFTLINE_TEST_LOG: requestLog,
    },
    encoding: "utf8",
  });
}

const requests = () => readFileSync(requestLog, "utf8").split("\n").filter(Boolean);
const scan = (...flags: string[]) =>
  runCli(["--repo", tmpRepo, ...flags.filter((f) => f === "--json"), "scan", ...flags.filter((f) => f !== "--json")]);
const digest = (...flags: string[]) => runCli(["--repo", tmpRepo, ...flags, "digest"]);
const cachePath = () => join(tmpRepo, ".driftline", "last-scan.json");

describe("CLI end to end: supply-chain phase 1", () => {
  it("scan --json returns the { ok, data, overflow, skipped } envelope", () => {
    writeProject({ foo: "^1.0.0" }, { foo: "1.0.0" });
    writeFixture({ latest: { foo: "1.1.0" } });
    const result = scan("--json");
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed), ["ok", "data", "overflow", "skipped"]);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.overflow, 0);
    assert.deepEqual(parsed.skipped, { count: 0, total: 1, reasons: { "no-lockfile": 0, "unsupported-lockfile": 0, "lockfile-unreadable": 0, "not-in-lockfile": 0 } });
    assert.equal(parsed.data.length, 1);
  });

  it("shows a compromised package as a loud top card, with its version list fetched and a never-auto-pin prompt", () => {
    writeProject({ "@ctrl/tinycolor": "^4.1.0", lodash: "^4.17.0", foo: "^1.0.0" }, { "@ctrl/tinycolor": "4.1.1", lodash: "4.17.15", foo: "1.0.0" });
    writeFileSync(join(tmpRepo, "a.ts"), `import { TinyColor } from "@ctrl/tinycolor";\n`);
    const malWithList = {
      ...tinycolorMal,
      affected: [{ package: { name: "@ctrl/tinycolor", ecosystem: "npm" }, versions: ["4.1.1", "4.1.2"] }],
    };
    writeFixture({
      latest: { "@ctrl/tinycolor": "4.2.0", lodash: "5.0.0", foo: "1.1.0" },
      versions: { "@ctrl/tinycolor": ["4.0.0", "4.1.0", "4.1.1", "4.1.2", "4.2.0"] },
      times: { "@ctrl/tinycolor": { "4.0.0": daysAgo(300), "4.1.0": daysAgo(200), "4.2.0": daysAgo(1) } },
      osv: { "@ctrl/tinycolor": [malWithList], lodash: [lodashVuln] },
    });

    const json = JSON.parse(scan("--json").stdout);
    assert.deepEqual(json.data.map((i: { name: string; category: string }) => [i.name, i.category]), [
      ["@ctrl/tinycolor", "compromised"],
      ["lodash", "security"],
      ["foo", "minor"],
    ]);
    const [evil, lodash] = json.data;
    assert.equal(evil.currentVersion, "4.1.1");
    assert.deepEqual(evil.advisoryIds, ["MAL-2025-47141"]);
    assert.equal(evil.safeVersions.lastKnownGood.version, "4.1.0");
    assert.equal(evil.safeVersions.newestNotListedBad.version, "4.2.0");
    assert.equal(evil.safeVersions.newestNotListedBad.cooldown.daysOld, 1);
    assert.equal(evil.releasedAt, evil.safeVersions.newestNotListedBad.releasedAt);
    assert.deepEqual(evil.affectedFiles, [{ path: "a.ts", confidence: "high" }]);
    assert.match(evil.prompt, /Do NOT change the pinned version/);
    assert.match(evil.prompt, /`npm ci`/);
    assert.equal(lodash.safeVersions, undefined);

    // The version list is only requested for the compromised package, once (it doubles as the publish-time lookup).
    const packuments = requests().filter((r) => /^GET https:\/\/registry\.npmjs\.org\/[^ ]+$/.test(r) && !r.endsWith("/latest"));
    assert.equal(packuments.filter((r) => r.includes("tinycolor")).length, 1);

    const text = scan();
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /1 compromised package/);
    assert.match(text.stdout, /\[COMPROMISED\]/);
    assert.match(text.stdout, /4\.1\.1 is listed as malicious/);
    assert.match(text.stdout, /Last known-good before the bad versions: 4\.1\.0/);
    assert.match(text.stdout, /Newest not listed as bad: 4\.2\.0 \(released 1 day ago/);
    assert.ok(text.stdout.indexOf("Compromised packages (1)") < text.stdout.indexOf("Security fixes (1)"));
    assert.match(text.stdout, /Based on OSV\.dev and npm registry data/);
  });

  it("still shows the compromised card when the registry gives no version list", () => {
    writeProject({ evil: "^1.0.0" }, { evil: "1.0.1" });
    writeFixture({ latest: { evil: "1.1.0" }, osv: { evil: [{ id: "MAL-2026-1", summary: "Malicious code in evil (npm)" }] } });
    const result = scan();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[COMPROMISED\]/);
    assert.match(result.stdout, /Couldn't determine a known-good version/);
  });

  it("a pnpm-only project exits 0 with a warning block, and never prints the all-clear", () => {
    writeProject({ foo: "^1.0.0", bar: "^2.0.0" }, undefined, { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    writeFixture({ latest: { foo: "1.1.0", bar: "2.1.0" } });

    const text = scan();
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stderr, /Found pnpm-lock\.yaml, but Driftline only reads package-lock\.json/);
    assert.match(text.stdout, /! 2 of 2 packages were NOT checked: no installed version could be resolved\./);
    assert.match(text.stdout, /- 2 x a pnpm, yarn or bun lockfile was found, but only package-lock\.json is read/);
    assert.match(text.stdout, /No packages could be checked, so there is nothing to report\./);
    assert.doesNotMatch(text.stdout, /clear of known advisories|up to date/);
    assert.deepEqual(requests(), []);

    const json = JSON.parse(scan("--json").stdout);
    assert.equal(json.skipped.count, 2);
    assert.equal(json.skipped.reasons["unsupported-lockfile"], 2);
    assert.deepEqual(json.data, []);

    // The cache keeps skipped, so a later digest shows the same warning.
    assert.equal(JSON.parse(readFileSync(cachePath(), "utf8")).skipped.count, 2);
    const replay = digest();
    assert.match(replay.stdout, /2 of 2 packages were NOT checked/);
    assert.doesNotMatch(replay.stdout, /clear of known advisories/);
  });

  it("a project with no lockfile at all reports the no-lockfile reason", () => {
    writeProject({ foo: "^1.0.0" });
    writeFixture({ latest: { foo: "1.1.0" } });
    const json = JSON.parse(scan("--json").stdout);
    assert.equal(json.skipped.reasons["no-lockfile"], 1);
  });

  it("a partial scan shows the block above normal results and keeps the exit code 0", () => {
    writeProject({ foo: "^1.0.0", missing: "^1.0.0" }, { foo: "1.0.0" });
    writeFixture({ latest: { foo: "1.1.0" } });
    const result = scan();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 of 2 packages was NOT checked/);
    assert.match(result.stdout, /- 1 x not found in package-lock\.json/);
    assert.ok(result.stdout.indexOf("NOT checked") < result.stdout.indexOf("1. foo"));
  });

  it("keeps the all-clear when everything was checked and nothing is wrong", () => {
    writeProject({ foo: "^1.0.0" }, { foo: "1.0.0" });
    writeFixture({ latest: { foo: "1.0.0" } });
    const result = scan();
    assert.match(result.stdout, /Nothing to report — tracked dependencies are up to date and clear of known advisories\./);
    assert.doesNotMatch(result.stdout, /NOT checked/);
  });

  it("shows the lowest fix beside latest for a lodash-like package, and a major-upgrade fix for minimist", () => {
    writeProject({ lodash: "^4.17.0", minimist: "^0.0.8" }, { lodash: "4.17.15", minimist: "0.0.8" });
    writeFixture({
      latest: { lodash: "5.0.0", minimist: "1.2.8" },
      osv: { lodash: [lodashVuln], minimist: [minimistVuln] },
    });

    const text = scan();
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /4\.17\.15 -> 5\.0\.0/);
    assert.match(text.stdout, /Fix: 4\.18\.0 +\|/);
    assert.match(text.stdout, /0\.0\.8 -> 1\.2\.8/);
    assert.match(text.stdout, /Fix: 0\.2\.4 \(needs a major upgrade\)/);

    const json = JSON.parse(scan("--json").stdout);
    const byName = Object.fromEntries(json.data.map((i: { name: string }) => [i.name, i]));
    assert.equal(byName.lodash.fixedVersion, "4.18.0");
    assert.equal(byName.lodash.latestVersion, "5.0.0");
    assert.equal(byName.lodash.fixNeedsMajorUpgrade, undefined);
    assert.match(byName.lodash.prompt, /Upgrade `lodash` from 4\.17\.15 to 4\.18\.0/);
    assert.match(byName.lodash.prompt, /Latest on npm: 5\.0\.0/);
    assert.equal(byName.minimist.fixNeedsMajorUpgrade, true);
  });

  it("digest still renders a last-scan.json written before `skipped` existed, and digest --json gives skipped null", () => {
    writeProject({ lodash: "^4.17.0" }, { lodash: "4.17.15" });
    writeFixture({ latest: { lodash: "5.0.0" }, osv: { lodash: [lodashVuln] } });
    assert.equal(scan().status, 0);

    const cached = JSON.parse(readFileSync(cachePath(), "utf8"));
    assert.ok(cached.skipped);
    delete cached.skipped;
    writeFileSync(cachePath(), JSON.stringify(cached));

    const text = digest();
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /1 security fix/);
    assert.doesNotMatch(text.stdout, /NOT checked/);
    const json = JSON.parse(digest("--json").stdout);
    assert.equal(json.ok, true);
    assert.equal(json.skipped, null);
    assert.equal(json.overflow, 0);
    assert.equal(json.data.length, 1);

    // And with an old cache holding nothing, the all-clear stays (nothing is known to be skipped).
    writeFileSync(cachePath(), JSON.stringify({ worklist: [] }));
    assert.match(digest().stdout, /Nothing to report — tracked dependencies are up to date/);
    assert.equal(JSON.parse(digest("--json").stdout).skipped, null);
  });

  it("digest --json replays skipped from a current cache", () => {
    writeProject({ foo: "^1.0.0" }, undefined, { "yarn.lock": "" });
    writeFixture({ latest: {} });
    assert.equal(scan().status, 0);
    const json = JSON.parse(digest("--json").stdout);
    assert.equal(json.skipped.count, 1);
    assert.equal(json.skipped.reasons["unsupported-lockfile"], 1);
  });

  it("saved Markdown and JSON reports carry the skipped section, notes and compromised content", () => {
    writeProject({ evil: "^1.0.0", foo: "^1.0.0" }, { evil: "1.0.1" });
    writeFixture({
      latest: { evil: "1.1.0" },
      versions: { evil: ["1.0.0", "1.0.1", "1.1.0"] },
      osv: { evil: [{ id: "MAL-2026-1", summary: "Malicious code in evil (npm)", affected: [{ package: { name: "evil", ecosystem: "npm" }, versions: ["1.0.1"] }] }] },
    });
    const out = join(tmpMisc, "reports");
    const md = scan("--format", "markdown", "--output", out);
    assert.equal(md.status, 0, md.stderr);
    const mdText = readFileSync(join(out, readdirSync(out)[0]), "utf8");
    assert.match(mdText, /## Warning: packages not checked/);
    assert.match(mdText, /### 1\. evil \[COMPROMISED\]/);
    assert.match(mdText, /- Last known-good before the bad versions: 1\.0\.0/);
    assert.match(mdText, /## Notes/);

    const out2 = join(tmpMisc, "reports-json");
    const js = scan("--json", "--format", "json", "--output", out2);
    assert.equal(js.status, 0, js.stderr);
    const report = JSON.parse(readFileSync(join(out2, readdirSync(out2)[0]), "utf8"));
    assert.equal(report.skipped.count, 1);
    assert.equal(report.summary.compromised, 1);
    assert.ok(report.notes.length > 0);
  });
});
