import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAdvisories } from "../advisories.ts";

function fakeOsvFetch(vulns: unknown[]): typeof fetch {
  return (async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.package.ecosystem, "npm");
    return { ok: true, json: async () => ({ vulns }) } as Response;
  }) as typeof fetch;
}

test("fetchAdvisories maps OSV vulns to Advisory records, preferring the ADVISORY reference URL", async () => {
  const fetchImpl = fakeOsvFetch([
    {
      id: "GHSA-xxxx",
      summary: "Prototype pollution",
      database_specific: { severity: "high" },
      references: [
        { type: "WEB", url: "https://example.com/writeup" },
        { type: "ADVISORY", url: "https://github.com/advisories/GHSA-xxxx" },
      ],
    },
  ]);

  const advisories = await fetchAdvisories("lodash", "4.17.15", fetchImpl);

  assert.deepEqual(advisories, [
    {
      id: "GHSA-xxxx",
      summary: "Prototype pollution",
      severity: "high",
      url: "https://github.com/advisories/GHSA-xxxx",
    },
  ]);
});

test("fetchAdvisories falls back to the osv.dev URL when there's no ADVISORY reference", async () => {
  const fetchImpl = fakeOsvFetch([{ id: "OSV-1", summary: "Issue", references: [] }]);
  const advisories = await fetchAdvisories("pkg", "1.0.0", fetchImpl);
  assert.equal(advisories[0].url, "https://osv.dev/vulnerability/OSV-1");
});

test("fetchAdvisories falls back to a truncated 'details' field when summary is missing", async () => {
  const fetchImpl = fakeOsvFetch([{ id: "OSV-2", details: "x".repeat(300) }]);
  const advisories = await fetchAdvisories("pkg", "1.0.0", fetchImpl);
  assert.equal(advisories[0].summary.length, 200);
});

test("fetchAdvisories normalizes unrecognized or missing severity to 'unknown'", async () => {
  const fetchImpl = fakeOsvFetch([{ id: "OSV-3", summary: "x" }]);
  const advisories = await fetchAdvisories("pkg", "1.0.0", fetchImpl);
  assert.equal(advisories[0].severity, "unknown");
});

test("fetchAdvisories returns an empty array when the API call fails or 404s", async () => {
  const failing = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.deepEqual(await fetchAdvisories("pkg", "1.0.0", failing), []);

  const notOk = (async () => ({ ok: false, json: async () => ({}) }) as Response) as typeof fetch;
  assert.deepEqual(await fetchAdvisories("pkg", "1.0.0", notOk), []);
});

test("fetchAdvisories returns an empty array when a package has no known vulnerabilities", async () => {
  const fetchImpl = fakeOsvFetch([]);
  assert.deepEqual(await fetchAdvisories("pkg", "1.0.0", fetchImpl), []);
});
