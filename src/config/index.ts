import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ConfigError } from "../lib/errors.ts";
import { globalConfigPath, projectConfigPath } from "../lib/paths.ts";
import { CONFIG_KEY_PREFIXES, type LearningRadarConfig } from "./types.ts";

export type { LearningRadarConfig } from "./types.ts";

type JsonObject = Record<string, unknown>;

function readJsonFile(path: string): JsonObject {
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`Failed to read config file at ${path}: ${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("config file must contain a JSON object");
    }
    return parsed as JsonObject;
  } catch (err) {
    throw new ConfigError(`Failed to parse config file at ${path}: ${(err as Error).message}`);
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] = isPlainObject(value) && isPlainObject(existing) ? deepMerge(existing, value) : value;
  }
  return result;
}

export interface LoadConfigOptions {
  repoPath: string;
  /** --config flag: when set, this file is the *only* source (no merge with project/global). */
  explicitConfigPath?: string;
}

export interface LoadedConfig {
  config: LearningRadarConfig;
  /** Files that were actually found and merged in, in merge order (earlier = lower precedence). */
  sources: string[];
}

/**
 * Resolution order (highest precedence last): built-in defaults, global config
 * (~/.config/learning-radar/config.json — API keys live here so they can't be
 * committed by accident), then project config (<repo>/.learningradarrc.json —
 * non-secret preferences meant to be checked in). --config bypasses all of this
 * and loads a single file verbatim, for scripting/CI use.
 */
export function loadConfig(opts: LoadConfigOptions): LoadedConfig {
  if (opts.explicitConfigPath) {
    if (!existsSync(opts.explicitConfigPath)) {
      throw new ConfigError(`Config file not found: ${opts.explicitConfigPath}`);
    }
    return {
      config: readJsonFile(opts.explicitConfigPath) as LearningRadarConfig,
      sources: [opts.explicitConfigPath],
    };
  }

  const sources: string[] = [];
  let merged: JsonObject = {};

  for (const path of [globalConfigPath(), projectConfigPath(opts.repoPath)]) {
    if (existsSync(path)) {
      merged = deepMerge(merged, readJsonFile(path));
      sources.push(path);
    }
  }

  return { config: merged as LearningRadarConfig, sources };
}

export function getByPath(obj: JsonObject, keyPath: string): unknown {
  return keyPath.split(".").reduce<unknown>((acc, part) => {
    if (!isPlainObject(acc)) return undefined;
    return acc[part];
  }, obj);
}

function setByPath(obj: JsonObject, keyPath: string, value: unknown): void {
  const parts = keyPath.split(".");
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as JsonObject;
  }
  cursor[parts[parts.length - 1] as string] = value;
}

function assertKnownKey(keyPath: string): void {
  const topLevel = keyPath.split(".")[0];
  if (!CONFIG_KEY_PREFIXES.includes(topLevel as (typeof CONFIG_KEY_PREFIXES)[number])) {
    throw new ConfigError(
      `Unknown config key "${keyPath}" — expected one of: ${CONFIG_KEY_PREFIXES.map((p) => `${p}.*`).join(", ")}`,
    );
  }
}

/**
 * Writes a single key to the global config file (secrets belong here, never in
 * a repo-local file that might get committed). Creates the file/dir if needed.
 */
export function writeGlobalConfigValue(keyPath: string, value: string): string {
  assertKnownKey(keyPath);
  const path = globalConfigPath();
  const existing = readJsonFile(path);
  setByPath(existing, keyPath, value);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/** Masks secret values (anything under apiKeys.*) so `config list` never prints them in full. */
export function redactSecrets(config: LearningRadarConfig): LearningRadarConfig {
  const clone = JSON.parse(JSON.stringify(config)) as JsonObject;
  const apiKeys = clone.apiKeys;
  if (isPlainObject(apiKeys)) {
    for (const key of Object.keys(apiKeys)) {
      const value = apiKeys[key];
      if (typeof value === "string" && value.length > 0) {
        apiKeys[key] = value.length <= 4 ? "****" : `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
      }
    }
  }
  return clone as LearningRadarConfig;
}
