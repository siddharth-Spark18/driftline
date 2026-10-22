import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { ingestStack } from "../stack.ts";

let dir: string;
function makeRepo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "lr-ingest-skip-"));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const manifest = JSON.stringify({ dependencies: { foo: "^1.0.0" }, devDependencies: { bar: "^2.0.0" } });

describe("ingestStack: why packages could not be resolved", () => {
  for (const lockfile of ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) {
    it(`flags ${lockfile} as an unsupported lockfile and names it in the warning`, () => {
      const result = ingestStack(makeRepo({ "package.json": manifest, [lockfile]: "" }));
      assert.deepEqual(result.packages.map((p) => [p.name, p.installedVersion, p.skipReason]), [
        ["bar", null, "unsupported-lockfile"],
        ["foo", null, "unsupported-lockfile"],
      ]);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], new RegExp(lockfile.replace(".", "\\.")));
      assert.match(result.warnings[0], /only reads package-lock\.json/);
      assert.match(result.warnings[0], /skipped, not checked/);
      // The old text promised a fallback that does not exist.
      assert.doesNotMatch(result.warnings[0], /fall ?back|falling back/i);
    });
  }

  it("uses no-lockfile when there is no lockfile at all", () => {
    const result = ingestStack(makeRepo({ "package.json": manifest }));
    assert.ok(result.packages.every((p) => p.skipReason === "no-lockfile" && p.installedVersion === null));
    assert.match(result.warnings.join("\n"), /No package-lock\.json found.*skipped, not checked/);
    assert.doesNotMatch(result.warnings.join("\n"), /fall ?back|falling back/i);
  });

  it("uses lockfile-unreadable for invalid JSON or an unrecognised format", () => {
    const bad = ingestStack(makeRepo({ "package.json": manifest, "package-lock.json": "{ nope" }));
    assert.ok(bad.packages.every((p) => p.skipReason === "lockfile-unreadable"));
    assert.match(bad.warnings.join("\n"), /not valid JSON/);
    rmSync(dir, { recursive: true, force: true });
    const odd = ingestStack(makeRepo({ "package.json": manifest, "package-lock.json": JSON.stringify({ lockfileVersion: 3 }) }));
    assert.ok(odd.packages.every((p) => p.skipReason === "lockfile-unreadable"));
    assert.match(odd.warnings.join("\n"), /format not recognized/);
  });

  it("uses not-in-lockfile for a package missing from a readable lockfile, and no reason for resolved ones", () => {
    const result = ingestStack(
      makeRepo({
        "package.json": manifest,
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/foo": { version: "1.2.3" } } }),
      }),
    );
    const byName = Object.fromEntries(result.packages.map((p) => [p.name, p]));
    assert.equal(byName.foo.installedVersion, "1.2.3");
    assert.equal("skipReason" in byName.foo, false);
    assert.equal(byName.bar.installedVersion, null);
    assert.equal(byName.bar.skipReason, "not-in-lockfile");
    assert.deepEqual(result.warnings, []);
  });

  it("reads package-lock.json normally even when another manager's lockfile sits beside it", () => {
    const result = ingestStack(
      makeRepo({
        "package.json": manifest,
        "pnpm-lock.yaml": "",
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/foo": { version: "1.0.0" }, "node_modules/bar": { version: "2.0.0" } } }),
      }),
    );
    assert.ok(result.packages.every((p) => p.installedVersion !== null && !("skipReason" in p)));
    assert.deepEqual(result.warnings, []);
  });
});
