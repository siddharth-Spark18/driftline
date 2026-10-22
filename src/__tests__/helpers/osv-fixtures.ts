// OSV vulnerability fixtures shaped like live api.osv.dev responses, shared by the supply-chain tests.

/** MAL-: no severity, no CVSS, a SEMVER range plus an explicit version list. */
export const tinycolorMal = {
  id: "MAL-2025-47141",
  summary: "Malicious code in @ctrl/tinycolor (npm)",
  details: "Malicious code was found in this package.",
  database_specific: { "malicious-packages-origins": [{ source: "ghsa-malware", id: "GHSA-xxxx" }] },
  affected: [
    {
      package: { name: "@ctrl/tinycolor", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "4.1.1" }, { last_affected: "4.1.2" }] }],
      versions: ["4.1.2", "4.1.1"],
    },
  ],
};

/** GHSA tagged CWE-506. Lists BOTH event-stream and flatmap-stream. */
export const eventStreamGhsa = {
  id: "GHSA-mh6f-8j2x-4483",
  summary: "Malicious Package in flatmap-stream",
  database_specific: { cwe_ids: ["CWE-506"], severity: "CRITICAL" },
  references: [{ type: "ADVISORY", url: "https://github.com/advisories/GHSA-mh6f-8j2x-4483" }],
  affected: [
    {
      package: { name: "event-stream", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "3.3.6" }, { fixed: "4.0.0" }] }],
      versions: ["3.3.6"],
    },
    {
      package: { name: "flatmap-stream", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }],
      versions: ["0.1.1"],
    },
  ],
};

/** HIGH GHSA classified as compromised by the CWE-506 rule; one fix per release line. */
export const uaParserGhsa = {
  id: "GHSA-pjwm-rvh2-c87w",
  summary: "Embedded malware in ua-parser-js",
  database_specific: { cwe_ids: ["CWE-506"], severity: "HIGH" },
  affected: [
    {
      package: { name: "ua-parser-js", ecosystem: "npm" },
      ranges: [
        {
          type: "SEMVER",
          events: [{ introduced: "0" }, { fixed: "0.7.30" }, { introduced: "0.8.0" }, { fixed: "0.8.1" }, { introduced: "1.0.0" }, { fixed: "1.0.1" }],
        },
      ],
    },
  ],
};

/** Ordinary vulnerability with a fix in the same major. */
export const lodashVuln = {
  id: "GHSA-lodash-0001",
  summary: "Prototype pollution in lodash",
  database_specific: { cwe_ids: ["CWE-1321"], severity: "HIGH" },
  references: [{ type: "ADVISORY", url: "https://github.com/advisories/GHSA-lodash-0001" }],
  affected: [
    {
      package: { name: "lodash", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.18.0" }] }],
    },
  ],
};

/** Fixed only in 0.2.4 (a different minor for 0.x) and 1.2.6. */
export const minimistVuln = {
  id: "GHSA-minimist-0001",
  summary: "Prototype pollution in minimist",
  database_specific: { severity: "CRITICAL" },
  affected: [
    {
      package: { name: "minimist", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.2.4" }, { introduced: "1.0.0" }, { fixed: "1.2.6" }] }],
    },
  ],
};
