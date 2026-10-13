import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** `name@version` -> ISO publish time. Publish times never change, so entries never expire. */
export type PublishTimes = Record<string, string>;

/** User cache directory: `$XDG_CACHE_HOME/driftline`, else `~/.cache/driftline`. */
export function publishCachePath(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "driftline", "publish-times.json");
}

export function publishCacheKey(name: string, version: string): string {
  return `${name}@${version}`;
}

/** Reads the cache; a missing, unreadable or corrupt file (or bad entry) is treated as empty, never an error. */
export function loadPublishCache(path: string): PublishTimes {
  const times: PublishTimes = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return times;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && !Number.isNaN(Date.parse(value))) times[key] = value;
    }
  } catch {
    // missing or corrupt: start empty
  }
  return times;
}

/**
 * Merges `fresh` entries into the on-disk cache. Re-reads the file first so a
 * concurrent run's entries aren't lost, and writes via a temp file + rename so
 * a reader never sees a half-written file. Failures (e.g. read-only home) are ignored.
 */
export function savePublishCache(path: string, fresh: PublishTimes): void {
  if (Object.keys(fresh).length === 0) return;
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmpPath, `${JSON.stringify({ ...loadPublishCache(path), ...fresh }, null, 2)}\n`);
    renameSync(tmpPath, path);
  } catch {
    try {
      unlinkSync(tmpPath);
    } catch {
      // nothing to clean up
    }
  }
}
