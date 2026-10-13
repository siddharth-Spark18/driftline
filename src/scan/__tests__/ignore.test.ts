import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIgnoreMatcher } from "../ignore.ts";

describe("createIgnoreMatcher", () => {
  it("matches nothing for an empty list", () => {
    const match = createIgnoreMatcher([]);
    assert.equal(match("anything"), false);
  });

  it("matches exact names only", () => {
    const match = createIgnoreMatcher(["left-pad", "@scope/pkg"]);
    assert.equal(match("left-pad"), true);
    assert.equal(match("@scope/pkg"), true);
    assert.equal(match("left-pad-2"), false);
    assert.equal(match("pkg"), false);
  });

  it("matches @types/* globs", () => {
    const match = createIgnoreMatcher(["@types/*"]);
    assert.equal(match("@types/node"), true);
    assert.equal(match("@types/react"), true);
    assert.equal(match("@types/scope__pkg"), true);
    assert.equal(match("typescript"), false);
    assert.equal(match("@typesafe/x"), false);
  });

  it("does not let * cross a slash", () => {
    const match = createIgnoreMatcher(["@types/*", "@babel/*"]);
    assert.equal(match("@types/a/b"), false);
    assert.equal(match("@babel/core/lib"), false);
    const anyScope = createIgnoreMatcher(["*"]);
    assert.equal(anyScope("left-pad"), true);
    assert.equal(anyScope("@scope/pkg"), false);
  });

  it("supports prefix, suffix and infix wildcards", () => {
    const match = createIgnoreMatcher(["eslint-*", "*-loader", "a*z"]);
    assert.equal(match("eslint-plugin-x"), true);
    assert.equal(match("css-loader"), true);
    assert.equal(match("abcz"), true);
    assert.equal(match("eslint"), false);
  });

  it("escapes regex metacharacters in patterns", () => {
    const match = createIgnoreMatcher(["lodash.merge", "a+b*"]);
    assert.equal(match("lodash.merge"), true);
    assert.equal(match("lodashXmerge"), false);
    assert.equal(match("a+bc"), true);
    assert.equal(match("aab"), false);
  });
});
