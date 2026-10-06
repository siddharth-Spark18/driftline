import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntry = join(projectRoot, "src", "cli.ts");

let tmpHome: string;
let tmpRepo: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "lr-home-"));
  tmpRepo = mkdtempSync(join(tmpdir(), "lr-repo-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpRepo, { recursive: true, force: true });
});

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd: projectRoot,
    env: { ...process.env, HOME: tmpHome },
    encoding: "utf8",
  });
}

test("--help exits 0 and lists the registered subcommands", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /scan/);
  assert.match(result.stdout, /config/);
  assert.match(result.stdout, /digest/);
});

test("scan against a repo with no package.json exits with a usage error", () => {
  const result = runCli(["--repo", tmpRepo, "scan"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No package\.json found/);
});

test("scan --json emits a structured error envelope on stderr", () => {
  const result = runCli(["--repo", tmpRepo, "--json", "scan"]);
  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stdout || result.stderr);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "UsageError");
});

test("scan --json on a repo with no dependencies returns an empty worklist without hitting the network", () => {
  writeFileSync(join(tmpRepo, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));

  const result = runCli(["--repo", tmpRepo, "--json", "scan"]);

  assert.equal(result.status, 0);
  assert.match(result.stderr, /No package-lock\.json found/);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed, { ok: true, data: [] });
});

test("scan on a repo with no dependencies prints a clean terminal digest and caches the result", () => {
  writeFileSync(join(tmpRepo, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));

  const result = runCli(["--repo", tmpRepo, "scan"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Learning Radar digest/);
  assert.match(result.stdout, /Nothing to report/);
  assert.equal(existsSync(join(tmpRepo, ".learning-radar", "last-scan.json")), true);
});

test("digest renders the cached worklist from the last scan without re-scanning", () => {
  writeFileSync(join(tmpRepo, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  runCli(["--repo", tmpRepo, "scan"]);

  const result = runCli(["--repo", tmpRepo, "digest"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Learning Radar digest/);
  assert.match(result.stdout, /Nothing to report/);
});

test("digest exits clearly when no scan has been run yet", () => {
  const result = runCli(["--repo", tmpRepo, "digest"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run `learning-radar scan` first/);
});

test("unknown subcommand is a usage error (exit code 2)", () => {
  const result = runCli(["not-a-real-command"]);
  assert.equal(result.status, 2);
});

test("config set/get/list round-trip through the global config file", () => {
  const setResult = runCli(["config", "set", "preferences.ignorePackages", "left-pad"]);
  assert.equal(setResult.status, 0);

  const getResult = runCli(["config", "get", "preferences.ignorePackages"]);
  assert.equal(getResult.status, 0);
  assert.match(getResult.stdout, /left-pad/);

  const listResult = runCli(["--json", "config", "list"]);
  assert.equal(listResult.status, 0);
  const parsed = JSON.parse(listResult.stdout);
  assert.equal(parsed.data.config.preferences.ignorePackages, "left-pad");
});

test("config set masks secrets on a subsequent list, never printing the raw key", () => {
  runCli(["config", "set", "apiKeys.anthropic", "sk-ant-abcdefgh1234"]);
  const listResult = runCli(["--json", "config", "list"]);
  const parsed = JSON.parse(listResult.stdout);
  assert.equal(parsed.data.config.apiKeys.anthropic, "***************1234");
});

test("config get on an unset key exits 1 with a clear message", () => {
  const result = runCli(["config", "get", "apiKeys.anthropic"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No config value set/);
});
