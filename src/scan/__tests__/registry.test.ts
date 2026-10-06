import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLatestVersion } from "../registry.ts";

function fakeFetch(responses: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    if (!(url in responses)) return { ok: false, json: async () => ({}) } as Response;
    return { ok: true, json: async () => responses[url] } as Response;
  }) as typeof fetch;
}

test("fetchLatestVersion requests the lightweight /latest endpoint, not the full packument", async () => {
  let requestedUrl = "";
  const fetchImpl = (async (input: string | URL) => {
    requestedUrl = String(input);
    return { ok: true, json: async () => ({ version: "1.2.3" }) } as Response;
  }) as typeof fetch;

  await fetchLatestVersion("some-pkg", fetchImpl);

  assert.equal(requestedUrl, "https://registry.npmjs.org/some-pkg/latest");
});

test("fetchLatestVersion URL-encodes scoped package names", async () => {
  let requestedUrl = "";
  const fetchImpl = (async (input: string | URL) => {
    requestedUrl = String(input);
    return { ok: true, json: async () => ({ version: "1.0.0" }) } as Response;
  }) as typeof fetch;

  await fetchLatestVersion("@types/node", fetchImpl);

  assert.equal(requestedUrl, "https://registry.npmjs.org/@types%2Fnode/latest");
});

test("fetchLatestVersion extracts version, deprecated, and a string repository field", async () => {
  const fetchImpl = fakeFetch({
    "https://registry.npmjs.org/pkg/latest": {
      version: "2.0.0",
      deprecated: "use pkg2 instead",
      repository: "https://github.com/acme/pkg",
    },
  });

  const info = await fetchLatestVersion("pkg", fetchImpl);

  assert.deepEqual(info, {
    latestVersion: "2.0.0",
    deprecated: "use pkg2 instead",
    repositoryUrl: "https://github.com/acme/pkg",
  });
});

test("fetchLatestVersion extracts repository.url when repository is an object", async () => {
  const fetchImpl = fakeFetch({
    "https://registry.npmjs.org/pkg/latest": {
      version: "2.0.0",
      repository: { type: "git", url: "git+https://github.com/acme/pkg.git" },
    },
  });

  const info = await fetchLatestVersion("pkg", fetchImpl);

  assert.equal(info?.repositoryUrl, "git+https://github.com/acme/pkg.git");
});

test("fetchLatestVersion returns null on a non-ok response (e.g. 404 for an unpublished package)", async () => {
  const fetchImpl = (async () => ({ ok: false, json: async () => ({}) }) as Response) as typeof fetch;
  assert.equal(await fetchLatestVersion("nonexistent-pkg", fetchImpl), null);
});

test("fetchLatestVersion returns null on a network failure instead of throwing", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  assert.equal(await fetchLatestVersion("pkg", fetchImpl), null);
});

test("fetchLatestVersion returns null when the response has no version field", async () => {
  const fetchImpl = fakeFetch({ "https://registry.npmjs.org/pkg/latest": { name: "pkg" } });
  assert.equal(await fetchLatestVersion("pkg", fetchImpl), null);
});
