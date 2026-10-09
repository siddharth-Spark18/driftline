import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { getByPath, loadConfig, redactSecrets, writeGlobalConfigValue } from "../index.ts";

let tmpHome: string;
let tmpRepo: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "lr-home-"));
  tmpRepo = mkdtempSync(join(tmpdir(), "lr-repo-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpRepo, { recursive: true, force: true });
});

test("loadConfig returns empty config with no sources when nothing is on disk", () => {
  const { config, sources } = loadConfig({ repoPath: tmpRepo });
  assert.deepEqual(config, {});
  assert.deepEqual(sources, []);
});

test("writeGlobalConfigValue persists under the global config dir and loadConfig picks it up", () => {
  const path = writeGlobalConfigValue("apiKeys.anthropic", "sk-ant-test-12345");
  assert.ok(path.includes(".config/driftline/config.json"));

  const { config, sources } = loadConfig({ repoPath: tmpRepo });
  assert.equal(config.apiKeys?.anthropic, "sk-ant-test-12345");
  assert.deepEqual(sources, [path]);
});

test("project config overrides global config on conflicting keys, global fills the rest", () => {
  writeGlobalConfigValue("preferences.digest.schedule", "0 9 * * MON");
  writeGlobalConfigValue("apiKeys.anthropic", "global-key");

  writeFileSync(
    join(tmpRepo, ".driftlinerc.json"),
    JSON.stringify({ preferences: { ignorePackages: ["left-pad"] } }),
  );

  const { config, sources } = loadConfig({ repoPath: tmpRepo });
  assert.equal(config.apiKeys?.anthropic, "global-key");
  assert.equal(config.preferences?.digest?.schedule, "0 9 * * MON");
  assert.deepEqual(config.preferences?.ignorePackages, ["left-pad"]);
  assert.equal(sources.length, 2);
});

test("--config bypasses project/global merge entirely", () => {
  writeGlobalConfigValue("apiKeys.anthropic", "global-key");
  const explicitPath = join(tmpRepo, "custom.json");
  writeFileSync(explicitPath, JSON.stringify({ apiKeys: { anthropic: "explicit-key" } }));

  const { config, sources } = loadConfig({ repoPath: tmpRepo, explicitConfigPath: explicitPath });
  assert.equal(config.apiKeys?.anthropic, "explicit-key");
  assert.deepEqual(sources, [explicitPath]);
});

test("getByPath reads nested values and returns undefined for missing paths", () => {
  const obj = { preferences: { digest: { schedule: "weekly" } } };
  assert.equal(getByPath(obj, "preferences.digest.schedule"), "weekly");
  assert.equal(getByPath(obj, "preferences.missing"), undefined);
});

test("redactSecrets masks apiKeys values but leaves preferences untouched", () => {
  const redacted = redactSecrets({
    apiKeys: { anthropic: "sk-ant-abcdefgh1234" },
    preferences: { ignorePackages: ["left-pad"] },
  });
  assert.equal(redacted.apiKeys?.anthropic, "***************1234");
  assert.deepEqual(redacted.preferences?.ignorePackages, ["left-pad"]);
});

test("writeGlobalConfigValue rejects unknown top-level keys", () => {
  assert.throws(() => writeGlobalConfigValue("notARealKey", "x"), /Unknown config key/);
});
