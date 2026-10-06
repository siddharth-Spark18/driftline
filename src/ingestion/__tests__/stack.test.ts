import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { UsageError } from "../../lib/errors.ts";
import { ingestStack } from "../stack.ts";

let dir: string;

function makeRepo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "lr-ingest-"));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("resolves installed versions from an npm v3 lockfile", () => {
  const repo = makeRepo({
    "package.json": JSON.stringify({
      dependencies: { foo: "^1.0.0" },
      devDependencies: { bar: "^2.0.0" },
    }),
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "repo" },
        "node_modules/foo": { version: "1.2.3" },
        "node_modules/bar": { version: "2.5.0" },
      },
    }),
  });

  const result = ingestStack(repo);

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.packages, [
    { name: "bar", declaredRange: "^2.0.0", dev: true, installedVersion: "2.5.0" },
    { name: "foo", declaredRange: "^1.0.0", dev: false, installedVersion: "1.2.3" },
  ]);
});

test("resolves installed versions from an npm v1 lockfile", () => {
  const repo = makeRepo({
    "package.json": JSON.stringify({ dependencies: { foo: "^1.0.0" } }),
    "package-lock.json": JSON.stringify({
      lockfileVersion: 1,
      dependencies: { foo: { version: "1.9.9" } },
    }),
  });

  const result = ingestStack(repo);
  assert.equal(result.packages[0]?.installedVersion, "1.9.9");
});

test("prefers the hoisted top-level version over a nested, non-hoisted resolution", () => {
  const repo = makeRepo({
    "package.json": JSON.stringify({ dependencies: { foo: "^1.0.0" } }),
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/bar/node_modules/foo": { version: "0.9.0" },
        "node_modules/foo": { version: "1.2.3" },
      },
    }),
  });

  const result = ingestStack(repo);
  assert.equal(result.packages[0]?.installedVersion, "1.2.3");
});

test("falls back to declared ranges with a warning when the lockfile is missing", () => {
  const repo = makeRepo({ "package.json": JSON.stringify({ dependencies: { foo: "^1.0.0" } }) });

  const result = ingestStack(repo);

  assert.equal(result.packages[0]?.installedVersion, null);
  assert.match(result.warnings[0] ?? "", /No package-lock\.json found/);
});

test("warns and falls back when the lockfile is malformed JSON", () => {
  const repo = makeRepo({
    "package.json": JSON.stringify({ dependencies: { foo: "^1.0.0" } }),
    "package-lock.json": "{not valid",
  });

  const result = ingestStack(repo);

  assert.equal(result.packages[0]?.installedVersion, null);
  assert.match(result.warnings[0] ?? "", /not valid JSON/);
});

test("throws UsageError when package.json is missing", () => {
  const repo = makeRepo({});
  assert.throws(() => ingestStack(repo), UsageError);
});

test("throws UsageError when package.json is malformed", () => {
  const repo = makeRepo({ "package.json": "{not valid json" });
  assert.throws(() => ingestStack(repo), UsageError);
});

test("tolerates a partial package.json with no dependency sections", () => {
  const repo = makeRepo({ "package.json": JSON.stringify({ name: "empty-repo" }) });
  const result = ingestStack(repo);
  assert.deepEqual(result.packages, []);
});

test("lets dependencies win over devDependencies on name collision", () => {
  const repo = makeRepo({
    "package.json": JSON.stringify({
      dependencies: { foo: "^1.0.0" },
      devDependencies: { foo: "^9.0.0" },
    }),
  });

  const result = ingestStack(repo);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0]?.declaredRange, "^1.0.0");
  assert.equal(result.packages[0]?.dev, false);
});

describe("monorepo / workspaces", () => {
  test("discovers workspace members declared via a 'dir/*' glob and reads their dependencies", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "root" },
          "packages/pkg-a": { name: "pkg-a", version: "1.0.0" },
          "node_modules/pkg-a": { resolved: "packages/pkg-a", link: true },
          "node_modules/chalk": { version: "5.3.0" },
        },
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: { chalk: "^5.0.0" },
      }),
    });

    const result = ingestStack(repo);
    const chalk = result.packages.find((p) => p.name === "chalk");
    assert.equal(chalk?.installedVersion, "5.3.0");
  });

  test("resolves a cross-member dependency via the sibling package's own declared version", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "root" },
          "packages/pkg-a": { name: "pkg-a", version: "1.0.0" },
          "packages/pkg-b": { name: "pkg-b", version: "1.0.0" },
          "node_modules/pkg-a": { resolved: "packages/pkg-a", link: true },
          "node_modules/pkg-b": { resolved: "packages/pkg-b", link: true },
        },
      }),
      "packages/pkg-a/package.json": JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: { "pkg-a": "^1.0.0" },
      }),
    });

    const result = ingestStack(repo);
    const pkgA = result.packages.find((p) => p.name === "pkg-a");
    assert.equal(pkgA?.installedVersion, "1.0.0");
  });

  test("lets a root-level declaration win over the same dependency declared in a workspace member", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: { chalk: "^4.0.0" },
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: { chalk: "^5.0.0" },
      }),
    });

    const result = ingestStack(repo);
    const chalk = result.packages.find((p) => p.name === "chalk");
    assert.equal(chalk?.declaredRange, "^4.0.0");
  });

  test("skips a workspace member with malformed package.json and warns instead of throwing", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
      "packages/pkg-a/package.json": "{not valid json",
    });

    const result = ingestStack(repo);
    assert.equal(result.packages.length, 0);
    assert.match(result.warnings[0] ?? "", /pkg-a.*not valid JSON/s);
  });

  test("supports the yarn-style { packages: [...] } workspaces object form", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: { packages: ["packages/*"] } }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: { foo: "^1.0.0" },
      }),
    });

    const result = ingestStack(repo);
    assert.equal(result.packages[0]?.name, "foo");
  });

  test("treats a repo with no 'workspaces' field as a single package (no behavior change)", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", dependencies: { foo: "^1.0.0" } }),
    });

    const result = ingestStack(repo);
    assert.equal(result.packages.length, 1);
    assert.equal(result.warnings.length, 1); // just the missing-lockfile warning
  });
});
