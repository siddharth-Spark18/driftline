import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadPublishCache, publishCacheKey, publishCachePath, savePublishCache } from "../publish-cache.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lr-pubcache-"));
  file = join(dir, "sub", "publish-times.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("publishCachePath", () => {
  it("uses $XDG_CACHE_HOME/driftline when set", () => {
    const original = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = "/xdg";
    try {
      assert.equal(publishCachePath(), join("/xdg", "driftline", "publish-times.json"));
    } finally {
      if (original === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = original;
    }
  });

  it("falls back to ~/.cache/driftline", () => {
    const original = process.env.XDG_CACHE_HOME;
    delete process.env.XDG_CACHE_HOME;
    try {
      assert.match(publishCachePath(), /\.cache[\\/]driftline[\\/]publish-times\.json$/);
    } finally {
      if (original !== undefined) process.env.XDG_CACHE_HOME = original;
    }
  });
});

describe("publish cache", () => {
  it("keys entries as name@version", () => {
    assert.equal(publishCacheKey("@scope/pkg", "1.2.3"), "@scope/pkg@1.2.3");
  });

  it("treats a missing file as empty", () => {
    assert.deepEqual(loadPublishCache(file), {});
  });

  it("treats corrupt or wrongly shaped files as empty", () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(file, "{ nope");
    assert.deepEqual(loadPublishCache(file), {});
    writeFileSync(file, "[1,2]");
    assert.deepEqual(loadPublishCache(file), {});
    writeFileSync(file, "null");
    assert.deepEqual(loadPublishCache(file), {});
  });

  it("drops bad entries but keeps good ones", () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(file, JSON.stringify({ "a@1.0.0": "2026-01-01T00:00:00.000Z", "b@1.0.0": "garbage", "c@1.0.0": 5 }));
    assert.deepEqual(loadPublishCache(file), { "a@1.0.0": "2026-01-01T00:00:00.000Z" });
  });

  it("creates the directory on save and round-trips", () => {
    savePublishCache(file, { "a@1.0.0": "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(loadPublishCache(file), { "a@1.0.0": "2026-01-01T00:00:00.000Z" });
  });

  it("merges fresh entries into what is already on disk", () => {
    savePublishCache(file, { "a@1.0.0": "2026-01-01T00:00:00.000Z" });
    savePublishCache(file, { "b@2.0.0": "2026-02-01T00:00:00.000Z" });
    assert.deepEqual(loadPublishCache(file), {
      "a@1.0.0": "2026-01-01T00:00:00.000Z",
      "b@2.0.0": "2026-02-01T00:00:00.000Z",
    });
  });

  it("writes nothing when there is nothing fresh", () => {
    savePublishCache(file, {});
    assert.deepEqual(readdirSync(dir), []);
  });

  it("is atomic: no temp files are left behind and the file is valid JSON", () => {
    savePublishCache(file, { "a@1.0.0": "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(readdirSync(join(dir, "sub")), ["publish-times.json"]);
    JSON.parse(readFileSync(file, "utf8"));
  });

  it("ignores an unwritable location without throwing", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
    const locked = join(dir, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    try {
      assert.doesNotThrow(() => savePublishCache(join(locked, "nested", "c.json"), { "a@1.0.0": "2026-01-01T00:00:00.000Z" }));
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it("ignores a path whose parent is a file without throwing", () => {
    writeFileSync(join(dir, "blocker"), "x");
    assert.doesNotThrow(() => savePublishCache(join(dir, "blocker", "c.json"), { "a@1.0.0": "2026-01-01T00:00:00.000Z" }));
  });
});
