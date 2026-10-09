import assert from "node:assert/strict";
import { test } from "node:test";
import { describeRelease, fetchReleaseByTag, parseGithubRepo, summarizeReleaseBody } from "../releases.ts";

test("parseGithubRepo handles common npm registry repository URL shapes", () => {
  assert.deepEqual(parseGithubRepo("git+https://github.com/acme/pkg.git"), { owner: "acme", repo: "pkg" });
  assert.deepEqual(parseGithubRepo("https://github.com/acme/pkg"), { owner: "acme", repo: "pkg" });
  assert.deepEqual(parseGithubRepo("git://github.com/acme/pkg.git"), { owner: "acme", repo: "pkg" });
  assert.deepEqual(parseGithubRepo("git@github.com:acme/pkg.git"), { owner: "acme", repo: "pkg" });
  assert.deepEqual(parseGithubRepo("https://github.com/acme/pkg.git#readme"), { owner: "acme", repo: "pkg" });
});

test("parseGithubRepo returns null for non-GitHub or missing URLs", () => {
  assert.equal(parseGithubRepo("https://gitlab.com/acme/pkg.git"), null);
  assert.equal(parseGithubRepo(undefined), null);
});

test("summarizeReleaseBody skips headings and blank lines, picks the first real line", () => {
  assert.equal(summarizeReleaseBody("# v2.0.0\n\nFixed a bug.\n"), "Fixed a bug.");
  assert.equal(summarizeReleaseBody(null), null);
  assert.equal(summarizeReleaseBody("# only a heading\n"), null);
});

test("summarizeReleaseBody truncates long lines", () => {
  const long = "a".repeat(200);
  const result = summarizeReleaseBody(long, 160);
  assert.equal(result?.length, 160);
  assert.ok(result?.endsWith("..."));
});

test("fetchReleaseByTag returns null on a non-ok response", async () => {
  const fetchImpl = (async () => ({ ok: false, json: async () => ({}) }) as Response) as typeof fetch;
  assert.equal(await fetchReleaseByTag({ owner: "acme", repo: "pkg" }, "v1.0.0", { rateLimited: false }, fetchImpl), null);
});

test("fetchReleaseByTag parses tag, url, and body from the GitHub API response", async () => {
  const fetchImpl = (async () =>
    ({
      ok: true,
      json: async () => ({
        tag_name: "v2.0.0",
        html_url: "https://github.com/acme/pkg/releases/tag/v2.0.0",
        body: "Changelog here",
      }),
    }) as Response) as typeof fetch;

  const release = await fetchReleaseByTag({ owner: "acme", repo: "pkg" }, "v2.0.0", { rateLimited: false }, fetchImpl);

  assert.deepEqual(release, {
    tagName: "v2.0.0",
    htmlUrl: "https://github.com/acme/pkg/releases/tag/v2.0.0",
    body: "Changelog here",
  });
});

test("describeRelease returns null when the repository URL isn't GitHub", async () => {
  const fetchImpl = (async () => {
    throw new Error("should not be called");
  }) as typeof fetch;
  assert.equal(await describeRelease("https://gitlab.com/acme/pkg", { name: "pkg", version: "1.0.0" }, { rateLimited: false }, fetchImpl), null);
});

test("describeRelease falls back to a generic reason when the release body is empty", async () => {
  const fetchImpl = (async () =>
    ({
      ok: true,
      json: async () => ({ tag_name: "v3.0.0", html_url: "https://github.com/acme/pkg/releases/tag/v3.0.0", body: null }),
    }) as Response) as typeof fetch;

  const described = await describeRelease(
    "https://github.com/acme/pkg",
    { name: "pkg", version: "3.0.0" },
    { rateLimited: false },
    fetchImpl,
  );

  assert.deepEqual(described, {
    reason: "New release: v3.0.0.",
    releaseUrl: "https://github.com/acme/pkg/releases/tag/v3.0.0",
  });
});
