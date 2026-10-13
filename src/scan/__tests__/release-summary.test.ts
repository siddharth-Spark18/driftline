import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeReleaseBody } from "../releases.ts";

describe("summarizeReleaseBody", () => {
  it("never returns a bare URL (regression)", () => {
    assert.equal(summarizeReleaseBody("https://example.com/blog/v2"), null);
    assert.equal(summarizeReleaseBody("<https://example.com/blog/v2>"), null);
    assert.equal(summarizeReleaseBody("www.example.com/blog"), null);
    assert.equal(summarizeReleaseBody("HTTPS://EXAMPLE.COM"), null);
  });

  it("skips a URL-only line and uses the next real line", () => {
    assert.equal(summarizeReleaseBody("https://example.com/blog\n\nAdds streaming support.\n"), "Adds streaming support.");
  });

  it("skips headings of every level", () => {
    assert.equal(summarizeReleaseBody("# Title\n## What's new\n### Details\nReal text.\n"), "Real text.");
  });

  it("skips fenced code blocks (backticks and tildes) including their contents", () => {
    assert.equal(summarizeReleaseBody("```js\nconst x = 1;\n```\nAfter the code.\n"), "After the code.");
    assert.equal(summarizeReleaseBody("~~~\nnpm i foo\n~~~\nAfter tildes.\n"), "After tildes.");
    assert.equal(summarizeReleaseBody("```\nnever closed\nstill code\n"), null);
  });

  it("skips badge lines, linked or not", () => {
    assert.equal(summarizeReleaseBody("[![Build](https://ci/badge.svg)](https://ci)\n![logo](x.png)\nHello there.\n"), "Hello there.");
  });

  it("skips 'Full Changelog' lines in plain and bold forms", () => {
    assert.equal(summarizeReleaseBody("**Full Changelog**: https://github.com/a/b/compare/v1...v2\n"), null);
    assert.equal(summarizeReleaseBody("Full Changelog: https://x.y/z\nFixed the bug.\n"), "Fixed the bug.");
  });

  it("skips horizontal rules and HTML comments", () => {
    assert.equal(summarizeReleaseBody("---\n***\n<!-- hidden\nmultiline -->\nVisible.\n"), "Visible.");
  });

  it("strips markdown to plain text", () => {
    assert.equal(
      summarizeReleaseBody("- **Fix** `parser` crash, see [the docs](https://x.y) and _more_ ~~old~~\n"),
      "Fix parser crash, see the docs and _more_ old",
    );
    assert.equal(summarizeReleaseBody("> quoted *emphasis* text\n"), "quoted emphasis text");
    assert.equal(summarizeReleaseBody("1. [ ] numbered item\n"), "numbered item");
    assert.equal(summarizeReleaseBody("* <b>bold</b> html\n"), "bold html");
  });

  it("returns null for empty, null, whitespace-only and all-skipped bodies", () => {
    assert.equal(summarizeReleaseBody(null), null);
    assert.equal(summarizeReleaseBody(""), null);
    assert.equal(summarizeReleaseBody("   \n\n  "), null);
    assert.equal(summarizeReleaseBody("# H\n---\nhttps://a.b\nFull Changelog: x\n```\ncode\n```\n"), null);
  });

  it("handles CRLF bodies", () => {
    assert.equal(summarizeReleaseBody("# H\r\n\r\nWindows line.\r\n"), "Windows line.");
  });

  it("truncates to maxLength with an ellipsis", () => {
    const out = summarizeReleaseBody("a".repeat(300), 50);
    assert.equal(out?.length, 50);
    assert.ok(out?.endsWith("..."));
    assert.equal(summarizeReleaseBody("short", 50), "short");
  });
});
