import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { createSpinner } from "../spinner.ts";

let errors: string[];
let writes: string[];
let originalNoColor: string | undefined;

beforeEach(() => {
  errors = [];
  writes = [];
  originalNoColor = process.env.NO_COLOR;
  mock.method(console, "error", (...args: unknown[]) => void errors.push(args.join(" ")));
  mock.method(process.stderr, "write", ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  mock.restoreAll();
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

describe("createSpinner", () => {
  it("is a no-op when disabled: nothing is written, but log still reaches stderr", () => {
    const spinner = createSpinner(false);
    spinner.start("Scanning");
    spinner.update("Still scanning");
    spinner.log("driftline: warning: x");
    spinner.stop();
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, ["driftline: warning: x"]);
  });

  it("draws a frame immediately on start and clears the line on stop when enabled", () => {
    const spinner = createSpinner(true);
    spinner.start("Scanning");
    assert.equal(writes.length, 1);
    assert.match(writes[0], /\r\x1b\[2K/);
    assert.match(writes[0], /Scanning/);
    spinner.stop();
    assert.equal(writes.at(-1), "\r\x1b[2K");
  });

  it("uses ASCII frames when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    const spinner = createSpinner(true);
    spinner.start("Scanning");
    spinner.stop();
    assert.match(writes[0], /[|/\\-] Scanning/);
    assert.doesNotMatch(writes[0], /[⠋⠙⠹]/);
  });

  it("log prints above the spinner: clear, message, redraw", () => {
    const spinner = createSpinner(true);
    spinner.start("Scanning");
    const before = writes.length;
    spinner.log("warn");
    spinner.stop();
    assert.deepEqual(errors, ["warn"]);
    assert.equal(writes[before], "\r\x1b[2K");
    assert.match(writes[before + 1], /Scanning/);
  });

  it("stop is idempotent and safe before start", () => {
    const spinner = createSpinner(true);
    assert.doesNotThrow(() => spinner.stop());
    spinner.start("x");
    spinner.stop();
    const count = writes.length;
    spinner.stop();
    assert.equal(writes.length, count);
  });

  it("log before start does not draw", () => {
    const spinner = createSpinner(true);
    spinner.log("early");
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, ["early"]);
  });
});
