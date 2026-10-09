import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorklist } from "../index.ts";
import type { InstalledPackage } from "../types.ts";

function pkg(overrides: Partial<InstalledPackage> & { name: string }): InstalledPackage {
  return { declaredRange: "^1.0.0", dev: false, installedVersion: "1.0.0", ...overrides };
}

function fakeFetch(options: {
  registry?: Record<string, unknown>;
  osv?: Record<string, unknown[]>;
  releases?: Record<string, unknown>;
}): typeof fetch {
  const registry = options.registry ?? {};
  const osv = options.osv ?? {};
  const releases = options.releases ?? {};

  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.startsWith("https://registry.npmjs.org/")) {
      const name = decodeURIComponent(
        url.replace("https://registry.npmjs.org/", "").replace(/\/latest$/, "").replace("%2F", "/"),
      );
      const data = registry[name];
      if (!data) return { ok: false, json: async () => ({}) } as Response;
      return { ok: true, json: async () => data } as Response;
    }

    if (url === "https://api.osv.dev/v1/query") {
      const body = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ vulns: osv[body.package.name] ?? [] }) } as Response;
    }

    if (url.startsWith("https://api.github.com/repos/")) {
      const match = url.match(/repos\/([^/]+)\/([^/]+)\/releases\/tags\/v\d/);
      const key = match ? `${match[1]}/${match[2]}` : "";
      const data = releases[key];
      if (!data) return { ok: false, json: async () => ({}) } as Response;
      return { ok: true, json: async () => data } as Response;
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

test("buildWorklist classifies security, breaking, deprecation, minor, and drops up-to-date/unresolved packages", async () => {
  const fetchImpl = fakeFetch({
    registry: {
      "has-vuln": { version: "1.0.0" },
      "major-bump": { version: "2.0.0", repository: "https://github.com/acme/major-bump" },
      deprecated: { version: "1.1.0", deprecated: "Use acme-new instead." },
      "minor-bump": { version: "1.1.0" },
      "up-to-date": { version: "1.0.0" },
    },
    osv: {
      "has-vuln": [
        {
          id: "OSV-1",
          summary: "Prototype pollution",
          database_specific: { severity: "high" },
          references: [{ type: "ADVISORY", url: "https://osv.dev/OSV-1" }],
        },
      ],
    },
    releases: {
      "acme/major-bump": {
        tag_name: "v2.0.0",
        html_url: "https://github.com/acme/major-bump/releases/tag/v2.0.0",
        body: "# v2.0.0\n\nRemoved the legacy callback API.\n",
      },
    },
  });

  const packages = [
    pkg({ name: "has-vuln" }),
    pkg({ name: "major-bump" }),
    pkg({ name: "deprecated" }),
    pkg({ name: "minor-bump" }),
    pkg({ name: "up-to-date" }),
    pkg({ name: "no-lockfile-resolution", installedVersion: null }),
    pkg({ name: "unpublished-or-unknown" }),
  ];

  const worklist = await buildWorklist(packages, { fetchImpl });

  assert.deepEqual(
    worklist.map((item) => item.name),
    ["has-vuln", "major-bump", "deprecated", "minor-bump"],
  );

  const vuln = worklist.find((item) => item.name === "has-vuln")!;
  assert.equal(vuln.category, "security");
  assert.equal(vuln.severity, "high");
  assert.equal(vuln.advisoryUrl, "https://osv.dev/OSV-1");

  const breaking = worklist.find((item) => item.name === "major-bump")!;
  assert.equal(breaking.category, "breaking");
  assert.equal(breaking.reason, "Removed the legacy callback API.");
  assert.equal(breaking.releaseUrl, "https://github.com/acme/major-bump/releases/tag/v2.0.0");

  const deprecated = worklist.find((item) => item.name === "deprecated")!;
  assert.equal(deprecated.category, "deprecation");
  assert.equal(deprecated.reason, "Use acme-new instead.");

  const minor = worklist.find((item) => item.name === "minor-bump")!;
  assert.equal(minor.category, "minor");
});

test("buildWorklist ranks a vulnerability as security even when the installed version is already latest", async () => {
  const fetchImpl = fakeFetch({
    registry: { "still-vulnerable": { version: "1.0.0" } },
    osv: {
      "still-vulnerable": [{ id: "OSV-2", summary: "Known issue, no fix yet", database_specific: { severity: "moderate" } }],
    },
  });

  const worklist = await buildWorklist([pkg({ name: "still-vulnerable" })], { fetchImpl });

  assert.equal(worklist.length, 1);
  assert.equal(worklist[0].category, "security");
});

test("buildWorklist returns an empty worklist for an empty package list", async () => {
  const fetchImpl = fakeFetch({});
  assert.deepEqual(await buildWorklist([], { fetchImpl }), []);
});
