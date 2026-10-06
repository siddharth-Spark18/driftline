import assert from "node:assert/strict";
import { test } from "node:test";
import { rankWorklist } from "../rank.ts";
import type { WorklistItem } from "../types.ts";

test("rankWorklist orders security > breaking > deprecation > minor, security by severity, then by name", () => {
  const items: WorklistItem[] = [
    { name: "zeta", currentVersion: "1.0.0", latestVersion: "1.1.0", category: "minor", reason: "" },
    { name: "alpha", currentVersion: "1.0.0", latestVersion: "2.0.0", category: "breaking", reason: "" },
    { name: "low-sev", currentVersion: "1.0.0", latestVersion: "1.0.1", category: "security", severity: "low", reason: "" },
    {
      name: "critical-sev",
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      category: "security",
      severity: "critical",
      reason: "",
    },
    { name: "beta", currentVersion: "1.0.0", latestVersion: "1.1.0", category: "deprecation", reason: "" },
  ];

  assert.deepEqual(
    rankWorklist(items).map((item) => item.name),
    ["critical-sev", "low-sev", "alpha", "beta", "zeta"],
  );
});

test("rankWorklist does not mutate its input and breaks ties alphabetically", () => {
  const items: WorklistItem[] = [
    { name: "bravo", currentVersion: "1.0.0", latestVersion: "1.1.0", category: "minor", reason: "" },
    { name: "alpha", currentVersion: "1.0.0", latestVersion: "1.1.0", category: "minor", reason: "" },
  ];

  const ranked = rankWorklist(items);

  assert.deepEqual(
    ranked.map((item) => item.name),
    ["alpha", "bravo"],
  );
  assert.equal(items[0].name, "bravo"); // original array order untouched
});
