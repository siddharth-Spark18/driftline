import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eventStreamGhsa, lodashVuln, tinycolorMal, uaParserGhsa } from "../../__tests__/helpers/osv-fixtures.ts";
import { fetchAdvisories } from "../advisories.ts";

const respond = (vulns: unknown[]): typeof fetch => (async () => ({ ok: true, json: async () => ({ vulns }) }) as Response) as typeof fetch;

describe("fetchAdvisories: OSV affected[] parsing", () => {
  it("parses a MAL- entry: compromised, no severity, SEMVER range and version list", async () => {
    const [adv] = await fetchAdvisories("@ctrl/tinycolor", "4.1.1", respond([tinycolorMal]));
    assert.equal(adv.id, "MAL-2025-47141");
    assert.equal(adv.kind, "compromised");
    assert.equal(adv.severity, "unknown");
    assert.deepEqual(adv.intervals, [{ introduced: "4.1.1", lastAffected: "4.1.2" }]);
    assert.deepEqual(adv.affectedVersions, ["4.1.2", "4.1.1"]);
    assert.deepEqual(adv.fixedVersions, []);
    assert.equal(adv.url, "https://osv.dev/vulnerability/MAL-2025-47141");
  });

  it("detects a MAL- id as compromised even without any affected[]", async () => {
    const [adv] = await fetchAdvisories("x", "1.0.0", respond([{ id: "MAL-2024-1", summary: "bad" }]));
    assert.equal(adv.kind, "compromised");
    assert.deepEqual(adv.intervals, []);
  });

  it("detects CWE-506 GHSA entries as compromised and keeps their severity", async () => {
    const [es] = await fetchAdvisories("event-stream", "3.3.6", respond([eventStreamGhsa]));
    assert.equal(es.kind, "compromised");
    assert.equal(es.severity, "critical");
    assert.equal(es.url, "https://github.com/advisories/GHSA-mh6f-8j2x-4483");
    const [ua] = await fetchAdvisories("ua-parser-js", "0.7.29", respond([uaParserGhsa]));
    assert.equal(ua.kind, "compromised");
    assert.equal(ua.severity, "high");
    assert.deepEqual(ua.fixedVersions, ["0.7.30", "0.8.1", "1.0.1"]);
    assert.deepEqual(ua.intervals[1], { introduced: "0.8.0", fixed: "0.8.1" });
  });

  it("keeps a CWE-506 tag among other CWEs, and leaves other CWEs as vulnerabilities", async () => {
    const withMany = { ...eventStreamGhsa, database_specific: { cwe_ids: ["CWE-79", "CWE-506"] } };
    assert.equal((await fetchAdvisories("event-stream", "3.3.6", respond([withMany])))[0].kind, "compromised");
    const [lodash] = await fetchAdvisories("lodash", "4.17.15", respond([lodashVuln]));
    assert.equal(lodash.kind, "vulnerability");
    assert.deepEqual(lodash.intervals, [{ introduced: "0", fixed: "4.18.0" }]);
    assert.deepEqual(lodash.fixedVersions, ["4.18.0"]);
  });

  it("filters affected[] to the scanned package: event-stream vs flatmap-stream", async () => {
    const [es] = await fetchAdvisories("event-stream", "3.3.6", respond([eventStreamGhsa]));
    assert.deepEqual(es.intervals, [{ introduced: "3.3.6", fixed: "4.0.0" }]);
    assert.deepEqual(es.affectedVersions, ["3.3.6"]);
    assert.deepEqual(es.fixedVersions, ["4.0.0"]);
    const [flat] = await fetchAdvisories("flatmap-stream", "0.1.1", respond([eventStreamGhsa]));
    assert.deepEqual(flat.intervals, [{ introduced: "0" }]);
    assert.deepEqual(flat.affectedVersions, ["0.1.1"]);
    assert.deepEqual(flat.fixedVersions, []);
  });

  it("ignores entries for other packages and non-npm ecosystems", async () => {
    const vuln = {
      id: "GHSA-x",
      affected: [
        { package: { name: "other", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "9.9.9" }] }], versions: ["1.0.0"] },
        { package: { name: "mine", ecosystem: "PyPI" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "8.8.8" }] }] },
      ],
    };
    const [adv] = await fetchAdvisories("mine", "1.0.0", respond([vuln]));
    assert.deepEqual(adv.intervals, []);
    assert.deepEqual(adv.affectedVersions, []);
    assert.deepEqual(adv.fixedVersions, []);
  });

  it("only uses SEMVER ranges and walks multiple introduced/fixed/last_affected events", async () => {
    const vuln = {
      id: "GHSA-y",
      affected: [
        {
          package: { name: "p", ecosystem: "npm" },
          ranges: [
            { type: "GIT", repo: "https://example.com/p", events: [{ introduced: "0" }, { fixed: "deadbeef" }] },
            { type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "7.0.0" }] },
            { type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "1.5.0" }, { introduced: "2.0.0" }, { last_affected: "2.3.0" }, { introduced: "3.0.0" }] },
          ],
        },
      ],
    };
    const [adv] = await fetchAdvisories("p", "1.0.0", respond([vuln]));
    assert.deepEqual(adv.intervals, [
      { introduced: "1.0.0", fixed: "1.5.0" },
      { introduced: "2.0.0", lastAffected: "2.3.0" },
      { introduced: "3.0.0" },
    ]);
    assert.deepEqual(adv.fixedVersions, ["1.5.0"]);
  });

  it("drops vulns without an id, tolerates a missing or odd affected field, and returns [] on HTTP or network failure", async () => {
    const advs = await fetchAdvisories("p", "1.0.0", respond([{ summary: "no id" }, { id: "A", affected: "nope" }, { id: "B", affected: [null, 3] }]));
    assert.deepEqual(advs.map((a) => a.id), ["A", "B"]);
    assert.deepEqual(advs[0].intervals, []);
    assert.deepEqual(await fetchAdvisories("p", "1.0.0", (async () => ({ ok: false }) as Response) as typeof fetch), []);
    assert.deepEqual(await fetchAdvisories("p", "1.0.0", (async () => { throw new Error("offline"); }) as typeof fetch), []);
  });
});
