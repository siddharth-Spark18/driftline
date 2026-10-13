import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

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
  tmpHome = mkdtempSync(join(tmpdir(), "lr-e2e-home-"));
  tmpCache = mkdtempSync(join(tmpdir(), "lr-e2e-cache-"));
  tmpRepo = mkdtempSync(join(tmpdir(), "lr-e2e-repo-"));
  tmpMisc = mkdtempSync(join(tmpdir(), "lr-e2e-misc-"));
  requestLog = join(tmpMisc, "requests.log");
  writeFileSync(requestLog, "");
  writeFixtureProject();
  writeRegistryFixture();
});

afterEach(() => {
  for (const dir of [tmpHome, tmpCache, tmpRepo, tmpMisc]) rmSync(dir, { recursive: true, force: true });
});

function writeFixtureProject(): void {
  writeFileSync(
    join(tmpRepo, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: { test: "node --test", build: "tsc" },
      dependencies: { foo: "^1.0.0", bar: "^1.0.0", "left-pad": "^1.3.0" },
      devDependencies: { "@types/node": "^20.0.0" },
    }),
  );
  const entry = (version: string) => ({ version });
  writeFileSync(
    join(tmpRepo, "package-lock.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture", version: "1.0.0" },
        "node_modules/foo": entry("1.0.0"),
        "node_modules/bar": entry("1.0.0"),
        "node_modules/left-pad": entry("1.3.0"),
        "node_modules/@types/node": entry("20.0.0"),
      },
    }),
  );
  mkdirSync(join(tmpRepo, "src"));
  writeFileSync(join(tmpRepo, "src", "a.ts"), `import foo from "foo";\nimport { readFileSync } from "node:fs";\n`);
}

function writeRegistryFixture(): void {
  writeFileSync(
    join(tmpMisc, "fixture.json"),
    JSON.stringify({
      latest: { foo: "1.1.0", bar: "2.0.0", "left-pad": "1.4.0", "@types/node": "20.1.0" },
      times: {
        foo: { "1.1.0": daysAgo(30) },
        bar: { "2.0.0": daysAgo(1) },
      },
      osv: {
        "left-pad": [
          { id: "OSV-1", summary: "Padding overflow", database_specific: { severity: "high" }, references: [{ type: "ADVISORY", url: "https://osv.dev/OSV-1" }] },
        ],
      },
    }),
  );
}

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
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
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

const requests = () => readFileSync(requestLog, "utf8").split("\n").filter(Boolean);
const packumentRequests = () => requests().filter((r) => /^GET https:\/\/registry\.npmjs\.org\/[^ ]+$/.test(r) && !r.endsWith("/latest"));
/** `--json` is a global flag (before the subcommand); every other flag belongs to `scan`. */
const scan = (...flags: string[]) =>
  runCli(["--repo", tmpRepo, ...flags.filter((f) => f === "--json"), "scan", ...flags.filter((f) => f !== "--json")]);

describe("CLI end to end (preloaded fake registry, OSV and GitHub)", () => {
  it("scan --json returns the ranked worklist plus overflow, with usage detection and prompts", () => {
    const result = scan("--json");
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.overflow, 0);
    assert.deepEqual(
      parsed.data.map((i: { name: string; category: string }) => [i.name, i.category]),
      [
        ["left-pad", "security"],
        ["bar", "breaking"],
        ["@types/node", "minor"],
        ["foo", "minor"],
      ],
    );

    const byName = Object.fromEntries(parsed.data.map((i: { name: string }) => [i.name, i]));
    assert.equal(byName["left-pad"].advisoryUrl, "https://osv.dev/OSV-1");
    assert.equal(byName.bar.cooldown.daysOld, 1);
    assert.equal(byName.bar.usageDetected, false);
    assert.match(byName.bar.prompt, /No usage detected/);
    assert.match(byName.bar.prompt, /`npm run test`, `npm run build`/);
    assert.deepEqual(byName.foo.affectedFiles, [{ path: "src/a.ts", confidence: "high" }]);
    assert.equal(byName.foo.prompt, undefined);
    // node:fs import counts as (medium) usage of @types/node.
    assert.deepEqual(byName["@types/node"].affectedFiles, [{ path: "src/a.ts", confidence: "medium" }]);
  });

  it("scan prints the terminal digest and writes the last-scan cache", () => {
    const result = scan();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Driftline digest/);
    assert.match(result.stdout, /1 security fix/);
    assert.match(result.stdout, /bar/);
    const cached = JSON.parse(readFileSync(join(tmpRepo, ".driftline", "last-scan.json"), "utf8"));
    assert.equal(cached.worklist.length, 4);
    assert.equal(cached.overflow, 0);
    assert.equal(cached.ignored, 0);
  });

  it("--limit caps the worklist, keeps security items, reports overflow, and skips publish lookups for cut items", () => {
    const result = scan("--json", "--limit", "1");
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.data.map((i: { name: string }) => i.name), ["left-pad"]);
    assert.equal(parsed.overflow, 3);
    assert.deepEqual(packumentRequests(), ["GET https://registry.npmjs.org/left-pad"]);
  });

  it("the publish-time cache makes a second run skip packument downloads", () => {
    assert.equal(scan("--json").status, 0);
    const firstRun = packumentRequests().length;
    assert.equal(firstRun, 4);
    assert.ok(existsSync(join(tmpCache, "driftline", "publish-times.json")));

    writeFileSync(requestLog, "");
    const second = scan("--json");
    assert.equal(second.status, 0, second.stderr);
    // foo and bar have publish times (now cached); left-pad and @types/node had none, so they are retried.
    const retried = packumentRequests().map((r) => decodeURIComponent(r.slice("GET https://registry.npmjs.org/".length)));
    assert.deepEqual(retried.sort(), ["@types/node", "left-pad"]);
  });

  it("preferences.ignorePackages hides packages, still shows an advisory, and prints the 'N ignored' note", () => {
    assert.equal(runCli(["config", "set", "preferences.ignorePackages", "@types/*,left-pad,foo"]).status, 0);
    const result = scan();
    assert.equal(result.status, 0, result.stderr);

    assert.match(result.stdout, /left-pad/);
    assert.match(result.stdout, /on your ignore list \(shown because of this advisory\)/);
    assert.match(result.stdout, /\bbar\b/);
    assert.doesNotMatch(result.stdout, /@types\/node/);
    assert.doesNotMatch(result.stdout, /\bfoo\b/);
    assert.match(result.stdout, /2 ignored \(preferences\.ignorePackages\)/);

    // Ignored packages never hit the /latest registry endpoint.
    const registry = requests().filter((r) => r.includes("registry.npmjs.org"));
    assert.ok(registry.every((r) => !/left-pad|foo|types/.test(r)), registry.join("\n"));
  });

  it("digest --json replays the cache and includes overflow, defaulting to 0 for caches written before it existed", () => {
    assert.equal(scan("--limit", "2").status, 0);
    const fresh = JSON.parse(runCli(["--repo", tmpRepo, "--json", "digest"]).stdout);
    assert.equal(fresh.overflow, 2);
    assert.equal(fresh.data.length, 2);

    const cachePath = join(tmpRepo, ".driftline", "last-scan.json");
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    delete cached.overflow;
    delete cached.ignored;
    writeFileSync(cachePath, JSON.stringify(cached));
    const legacy = JSON.parse(runCli(["--repo", tmpRepo, "--json", "digest"]).stdout);
    assert.equal(legacy.overflow, 0);
    assert.equal(legacy.data.length, 2);
  });

  it("digest shows the ignored note from the cache", () => {
    assert.equal(runCli(["config", "set", "preferences.ignorePackages", "@types/*"]).status, 0);
    assert.equal(scan().status, 0);
    const result = runCli(["--repo", tmpRepo, "digest"]);
    assert.match(result.stdout, /1 ignored \(preferences\.ignorePackages\)/);
  });

  it("--format markdown saves a report into --output and announces it", () => {
    const out = join(tmpMisc, "reports");
    const result = scan("--format", "markdown", "--output", out);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Saved Markdown report to .*driftline-.*\.md/);
    const [file] = readdirSync(out);
    const md = readFileSync(join(out, file), "utf8");
    assert.match(md, /# Driftline report/);
    assert.match(md, /### 1\. left-pad \[HIGH\]/);
  });

  it("--format json under --json keeps stdout a single JSON document", () => {
    const out = join(tmpMisc, "reports");
    const result = scan("--json", "--format", "json", "--output", out);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.match(result.stderr, /Saved JSON report to/);
    assert.equal(JSON.parse(readFileSync(join(out, readdirSync(out)[0]), "utf8")).overflow, 0);
  });

  it("rejects an invalid ignorePackages config with exit code 3", () => {
    mkdirSync(join(tmpHome, ".config", "driftline"), { recursive: true });
    writeFileSync(join(tmpHome, ".config", "driftline", "config.json"), JSON.stringify({ preferences: { ignorePackages: "foo" } }));
    const result = scan("--json");
    assert.equal(result.status, 3);
    // Node may print its own warnings to stderr (e.g. "(node:1234) ..."), so read just the envelope line.
    const envelope = result.stderr.split("\n").find((line) => line.startsWith("{"));
    assert.ok(envelope, `no JSON envelope on stderr: ${result.stderr}`);
    assert.equal(JSON.parse(envelope).error.code, "ConfigError");
  });

  it("rejects bad flags with exit code 2 before any network traffic", () => {
    assert.equal(scan("--format", "xml").status, 2);
    assert.equal(scan("--output", "x").status, 2);
    assert.equal(scan("--limit", "0").status, 2);
    assert.deepEqual(requests(), []);
  });
});
