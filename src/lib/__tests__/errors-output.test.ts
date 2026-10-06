import assert from "node:assert/strict";
import { test } from "node:test";
import { CliError, ConfigError, ExitCode, NotImplementedError, UsageError } from "../errors.ts";
import { printError, printSuccess } from "../output.ts";

function captureStream(stream: NodeJS.WriteStream, fn: () => void): string {
  const original = stream.write.bind(stream);
  let out = "";
  stream.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof stream.write;
  try {
    fn();
  } finally {
    stream.write = original;
  }
  return out;
}

test("printSuccess writes a JSON envelope in --json mode", () => {
  const out = captureStream(process.stdout, () => {
    printSuccess({ foo: "bar" }, "human message", { json: true });
  });
  assert.deepEqual(JSON.parse(out), { ok: true, data: { foo: "bar" } });
});

test("printSuccess writes the human message in text mode", () => {
  const out = captureStream(process.stdout, () => {
    printSuccess({ foo: "bar" }, "human message", { json: false });
  });
  assert.match(out, /human message/);
});

test("printError returns the error's exit code and reports it in JSON mode", () => {
  const err = new ConfigError("bad config", { path: "/tmp/x.json" });
  let code: ExitCode | undefined;
  const out = captureStream(process.stderr, () => {
    code = printError(err, { json: true });
  });
  assert.equal(code, ExitCode.ConfigError);
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.message, "bad config");
  assert.equal(parsed.error.code, "ConfigError");
  assert.deepEqual(parsed.error.details, { path: "/tmp/x.json" });
});

test("printError defaults non-CliError errors to GeneralError", () => {
  let code: ExitCode | undefined;
  captureStream(process.stderr, () => {
    code = printError(new Error("boom"), { json: false });
  });
  assert.equal(code, ExitCode.GeneralError);
});

test("UsageError and NotImplementedError carry the expected exit codes", () => {
  assert.equal(new UsageError("bad args").exitCode, ExitCode.UsageError);
  assert.equal(new NotImplementedError("soon").exitCode, ExitCode.GeneralError);
  assert.ok(new CliError("generic") instanceof Error);
});
