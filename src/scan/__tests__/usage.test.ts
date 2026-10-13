import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { detectUsage } from "../usage.ts";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "lr-usage-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function files(name: string, names: string[] = [name]) {
  return detectUsage(repo, names).get(name);
}

describe("detectUsage: imports in source", () => {
  it("detects static, side-effect, dynamic and require references with high confidence", () => {
    write("src/a.ts", `import foo from "foo";\n`);
    write("src/b.js", `import "foo";\n`);
    write("src/c.mjs", `const m = await import("foo");\n`);
    write("src/d.cjs", `const f = require('foo');\n`);
    assert.deepEqual(files("foo"), [
      { path: "src/a.ts", confidence: "high" },
      { path: "src/b.js", confidence: "high" },
      { path: "src/c.mjs", confidence: "high" },
      { path: "src/d.cjs", confidence: "high" },
    ]);
  });

  it("matches subpath imports and scoped packages to the package name", () => {
    write("src/a.ts", `import x from "lodash/fp";\nimport y from "@scope/pkg/deep/file";\n`);
    assert.equal(files("lodash")?.[0].path, "src/a.ts");
    assert.equal(files("@scope/pkg")?.[0].path, "src/a.ts");
  });

  it("ignores relative and absolute specifiers and unrelated packages", () => {
    write("src/a.ts", `import a from "./foo";\nimport b from "../foo";\nimport c from "/foo";\nimport d from "foobar";\n`);
    assert.deepEqual(files("foo"), []);
  });

  it("scans tsx and jsx files", () => {
    write("src/App.tsx", `import React from "react";\n`);
    write("src/B.jsx", `import React from "react";\n`);
    assert.equal(files("react")?.length, 2);
  });

  it("marks a reference on a comment line as low confidence", () => {
    write("src/a.ts", `// import foo from "foo";\n`);
    write("src/b.ts", ` * require("foo")\n`);
    write("src/c.ts", `/* import foo from "foo" */\n`);
    assert.deepEqual(
      files("foo")?.map((f) => f.confidence),
      ["low", "low", "low"],
    );
  });

  it("keeps the strongest confidence when a file has both a comment and a real import", () => {
    write("src/a.ts", `// import foo from "foo";\nimport foo from "foo";\n`);
    assert.deepEqual(files("foo"), [{ path: "src/a.ts", confidence: "high" }]);
  });

  it("sorts results high, then medium, then low, then by path", () => {
    write("src/z-high.ts", `import "foo";\n`);
    write("src/a-low.ts", `// import "foo"\n`);
    write("a.config.json", `{"plugin": "foo"}\n`);
    assert.deepEqual(files("foo"), [
      { path: "src/z-high.ts", confidence: "high" },
      { path: "a.config.json", confidence: "medium" },
      { path: "src/a-low.ts", confidence: "low" },
    ]);
  });

  it("returns an empty list for every requested package when nothing matches", () => {
    write("src/a.ts", `export const x = 1;\n`);
    const result = detectUsage(repo, ["foo", "bar"]);
    assert.deepEqual([...result.keys()], ["foo", "bar"]);
    assert.deepEqual(result.get("foo"), []);
  });
});

describe("detectUsage: @types packages", () => {
  it("credits @types/x as medium confidence wherever x is imported", () => {
    write("src/a.ts", `import express from "express";\n`);
    assert.deepEqual(files("@types/express"), [{ path: "src/a.ts", confidence: "medium" }]);
  });

  it("maps scoped packages to the @types/scope__pkg convention", () => {
    write("src/a.ts", `import x from "@scope/pkg";\n`);
    assert.deepEqual(files("@types/scope__pkg"), [{ path: "src/a.ts", confidence: "medium" }]);
  });

  it("counts node:fs, fs and fs/promises as medium usage of @types/node (regression)", () => {
    write("src/a.ts", `import { readFileSync } from "node:fs";\n`);
    write("src/b.ts", `import fs from "fs";\n`);
    write("src/c.ts", `import { readFile } from "fs/promises";\n`);
    write("src/d.js", `const os = require("node:os");\n`);
    assert.deepEqual(files("@types/node"), [
      { path: "src/a.ts", confidence: "medium" },
      { path: "src/b.ts", confidence: "medium" },
      { path: "src/c.ts", confidence: "medium" },
      { path: "src/d.js", confidence: "medium" },
    ]);
  });

  it("does not count non-builtin modules as @types/node usage", () => {
    write("src/a.ts", `import x from "fs-extra";\nimport y from "./fs";\n`);
    assert.deepEqual(files("@types/node"), []);
  });

  it("credits @types/node from tsconfig `types: [\"node\"]`", () => {
    write("tsconfig.json", `{"compilerOptions": {"types": ["node"]}}\n`);
    assert.deepEqual(files("@types/node"), [{ path: "tsconfig.json", confidence: "medium" }]);
  });
});

describe("detectUsage: scripts and config files", () => {
  it("credits a package whose name appears as a command in package.json scripts (medium)", () => {
    write("package.json", JSON.stringify({ scripts: { build: "tsup src/index.ts", lint: "echo tsup-not" } }));
    assert.deepEqual(files("tsup"), [{ path: "package.json", confidence: "medium" }]);
  });

  it("resolves bin names from node_modules manifests", () => {
    write("node_modules/typescript/package.json", JSON.stringify({ name: "typescript", bin: { tsc: "bin/tsc" } }));
    write("package.json", JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }));
    assert.deepEqual(files("typescript"), [{ path: "package.json", confidence: "medium" }]);
  });

  it("matches commands after shell operators", () => {
    write("package.json", JSON.stringify({ scripts: { ci: "npm run a && vitest run" } }));
    assert.equal(files("vitest")?.[0].confidence, "medium");
  });

  it("tolerates an unparseable package.json", () => {
    write("package.json", "{ not json");
    assert.deepEqual(files("foo"), []);
  });

  it("credits packages named in tool config files (medium)", () => {
    write(".eslintrc.json", `{"extends": ["eslint-config-acme"]}\n`);
    write("prettier.config.json", `{"plugins": ["prettier-plugin-x/dist"]}\n`);
    write("ci.yml", `uses: "foo-action"\n`);
    assert.deepEqual(files("eslint-config-acme"), [{ path: ".eslintrc.json", confidence: "medium" }]);
    assert.deepEqual(files("prettier-plugin-x"), [{ path: "prettier.config.json", confidence: "medium" }]);
    assert.deepEqual(files("foo-action"), [{ path: "ci.yml", confidence: "medium" }]);
  });
});

describe("detectUsage: skipped locations", () => {
  it("skips node_modules, dist and other build/cache directories", () => {
    for (const dir of ["node_modules/dep", "dist", "build", "coverage", ".next", ".driftline"]) {
      write(`${dir}/x.js`, `import "foo";\n`);
    }
    assert.deepEqual(files("foo"), []);
  });

  it("walks nested directories and workspace members", () => {
    write("packages/web/src/a.ts", `import "foo";\n`);
    assert.deepEqual(files("foo"), [{ path: "packages/web/src/a.ts", confidence: "high" }]);
  });

  it("honors plain names, directories and *.ext patterns from the root .gitignore", () => {
    write(".gitignore", "# comment\ngenerated\n/tmp/\n*.gen.ts\n!keep.ts\n");
    write("generated/a.ts", `import "foo";\n`);
    write("tmp/b.ts", `import "foo";\n`);
    write("src/c.gen.ts", `import "foo";\n`);
    write("src/real.ts", `import "foo";\n`);
    assert.deepEqual(files("foo"), [{ path: "src/real.ts", confidence: "high" }]);
  });

  it("skips files larger than 512 KiB", () => {
    write("src/big.ts", `import "foo";\n${"x".repeat(513 * 1024)}`);
    assert.deepEqual(files("foo"), []);
  });

  it("ignores non-source extensions for import detection", () => {
    write("README.md", `import foo from "foo";\n`);
    write("src/a.py", `import "foo"\n`);
    assert.deepEqual(files("foo"), []);
  });

  it("returns empty results for a missing repo directory instead of throwing", () => {
    const result = detectUsage(join(repo, "does-not-exist"), ["foo"]);
    assert.deepEqual(result.get("foo"), []);
  });
});
