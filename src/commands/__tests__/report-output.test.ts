import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { ExitCode, UsageError } from "../../lib/errors.ts";
import type { ReportData } from "../../report/types.ts";
import { addReportOptions, resolveSaveChoice, saveReport } from "../report-output.ts";

let dir: string;
const ttyDescriptors = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
};

function setTty(stdin: boolean, stdout: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lr-reportout-"));
});

afterEach(() => {
  mock.restoreAll();
  for (const [stream, key] of [[process.stdin, "stdin"], [process.stdout, "stdout"]] as const) {
    const original = ttyDescriptors[key];
    if (original) Object.defineProperty(stream, "isTTY", original);
    else delete (stream as { isTTY?: boolean }).isTTY;
  }
  rmSync(dir, { recursive: true, force: true });
});

async function usageError(opts: Record<string, unknown>): Promise<UsageError> {
  try {
    await resolveSaveChoice(opts);
  } catch (err) {
    assert.ok(err instanceof UsageError);
    assert.equal(err.exitCode, ExitCode.UsageError);
    return err;
  }
  throw new Error("expected a UsageError");
}

describe("resolveSaveChoice: flag validation", () => {
  it("rejects an unknown --format", async () => {
    assert.match((await usageError({ format: "xml" })).message, /--format must be one of json, markdown, got "xml"/);
  });

  it("rejects --output without --format", async () => {
    assert.match((await usageError({ output: "out" })).message, /--output requires --format/);
  });

  it("rejects a blank --output", async () => {
    assert.match((await usageError({ format: "json", output: "   " })).message, /non-empty directory/);
  });

  it("accepts a format and defaults the directory to the cwd", async () => {
    assert.deepEqual(await resolveSaveChoice({ format: "markdown" }), { format: "markdown", dir: process.cwd() });
  });

  it("accepts a format with an explicit output directory", async () => {
    assert.deepEqual(await resolveSaveChoice({ format: "json", output: "reports" }), { format: "json", dir: "reports" });
  });

  it("lets flags win over a TTY, so the menu is skipped", async () => {
    setTty(true, true);
    assert.deepEqual(await resolveSaveChoice({ format: "json", output: dir }), { format: "json", dir });
  });
});

describe("resolveSaveChoice: menu gate", () => {
  it("saves nothing when stdin is not a TTY", async () => {
    setTty(false, true);
    assert.equal(await resolveSaveChoice({}), null);
  });

  it("saves nothing when stdout is not a TTY (piped)", async () => {
    setTty(true, false);
    assert.equal(await resolveSaveChoice({}), null);
  });

  it("saves nothing under --json even in a real terminal", async () => {
    setTty(true, true);
    assert.equal(await resolveSaveChoice({ json: true }), null);
  });
});

describe("addReportOptions", () => {
  it("registers --format and --output", () => {
    const command = addReportOptions(new Command("x"));
    const flags = command.options.map((o) => o.long);
    assert.deepEqual(flags, ["--format", "--output"]);
  });
});

describe("saveReport", () => {
  const data = (worklist: ReportData["worklist"]): ReportData => ({
    scannedAt: "2026-10-13T10:00:00.000Z",
    repo: "/repo",
    driftlineVersion: "0.1.0",
    overflow: 2,
    worklist,
  });
  const worklist = [{ name: "a", currentVersion: "1.0.0", latestVersion: "2.0.0", category: "breaking" as const, reason: "r" }];

  it("writes nothing when there is no choice", () => {
    saveReport(null, data(worklist), { json: false });
    assert.deepEqual(readdirSync(dir), []);
  });

  it("writes nothing for an empty worklist", () => {
    const log = mock.method(console, "log", () => {});
    saveReport({ format: "json", dir }, data([]), { json: false });
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(log.mock.callCount(), 0);
  });

  it("writes a JSON report and announces it on stdout", () => {
    const log = mock.method(console, "log", () => {});
    saveReport({ format: "json", dir }, data(worklist), { json: false });
    const [file] = readdirSync(dir);
    assert.match(file, /^driftline-.*\.json$/);
    assert.equal(JSON.parse(readFileSync(join(dir, file), "utf8")).overflow, 2);
    assert.match(String(log.mock.calls[0].arguments[0]), /Saved JSON report to .*\.json/);
  });

  it("writes a Markdown report and, under --json, announces on stderr so stdout stays one JSON document", () => {
    const log = mock.method(console, "log", () => {});
    const error = mock.method(console, "error", () => {});
    saveReport({ format: "markdown", dir }, data(worklist), { json: true });
    const [file] = readdirSync(dir);
    assert.match(file, /\.md$/);
    assert.equal(log.mock.callCount(), 0);
    assert.match(String(error.mock.calls[0].arguments[0]), /Saved Markdown report to/);
  });
});
