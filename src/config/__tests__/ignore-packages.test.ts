import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ConfigError, ExitCode } from "../../lib/errors.ts";
import { loadConfig, resolveScanSettings, writeGlobalConfigValue } from "../index.ts";

let tmpHome: string;
let tmpRepo: string;
let originalHome: string | undefined;
let originalToken: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "lr-home-"));
  tmpRepo = mkdtempSync(join(tmpdir(), "lr-repo-"));
  originalHome = process.env.HOME;
  originalToken = process.env.GITHUB_TOKEN;
  process.env.HOME = tmpHome;
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpRepo, { recursive: true, force: true });
});

function throwsConfigError(fn: () => unknown, pattern: RegExp) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.exitCode, ExitCode.ConfigError);
    assert.match(err.message, pattern);
    return true;
  });
}

describe("config set preferences.ignorePackages", () => {
  it("stores a comma-separated value as a list (regression: used to store a string)", () => {
    const path = writeGlobalConfigValue("preferences.ignorePackages", "a,b");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).preferences.ignorePackages, ["a", "b"]);
  });

  it("stores a single value as a one-element list", () => {
    const path = writeGlobalConfigValue("preferences.ignorePackages", "left-pad");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).preferences.ignorePackages, ["left-pad"]);
  });

  it("trims whitespace and keeps globs and scoped names", () => {
    const path = writeGlobalConfigValue("preferences.ignorePackages", " @types/* , @babel/core ");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).preferences.ignorePackages, ["@types/*", "@babel/core"]);
  });

  it("an empty string clears the list", () => {
    writeGlobalConfigValue("preferences.ignorePackages", "a");
    const path = writeGlobalConfigValue("preferences.ignorePackages", "");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).preferences.ignorePackages, []);
  });

  it("rejects empty entries with a config error", () => {
    throwsConfigError(() => writeGlobalConfigValue("preferences.ignorePackages", "a,,b"), /empty entries/);
    throwsConfigError(() => writeGlobalConfigValue("preferences.ignorePackages", "a,"), /empty entries/);
  });

  it("is picked up by loadConfig and resolveScanSettings", () => {
    writeGlobalConfigValue("preferences.ignorePackages", "a,@types/*");
    const { config } = loadConfig({ repoPath: tmpRepo });
    assert.deepEqual(resolveScanSettings(config).ignorePackages, ["a", "@types/*"]);
  });
});

describe("resolveScanSettings: ignorePackages validation", () => {
  it("defaults to an empty list", () => {
    assert.deepEqual(resolveScanSettings({}).ignorePackages, []);
  });

  it("accepts a list of strings", () => {
    assert.deepEqual(resolveScanSettings({ preferences: { ignorePackages: ["a", "@types/*"] } }).ignorePackages, ["a", "@types/*"]);
  });

  it("rejects a plain string, a list with non-strings, and other types (exit 3)", () => {
    for (const bad of ["left-pad", [1, 2], ["a", null], { a: 1 }, 5, true]) {
      throwsConfigError(
        () => resolveScanSettings({ preferences: { ignorePackages: bad as unknown as string[] } }),
        /preferences\.ignorePackages must be a list/,
      );
    }
  });

  it("rejects empty entries from a hand-edited config", () => {
    throwsConfigError(() => resolveScanSettings({ preferences: { ignorePackages: ["a", " "] } }), /empty entries/);
  });

  it("a project .driftlinerc.json list is validated on load of settings", () => {
    writeFileSync(join(tmpRepo, ".driftlinerc.json"), JSON.stringify({ preferences: { ignorePackages: "oops" } }));
    const { config } = loadConfig({ repoPath: tmpRepo });
    throwsConfigError(() => resolveScanSettings(config), /must be a list/);
  });
});
