import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliError } from "../lib/errors.ts";
import type { ReportFormat } from "./types.ts";

const EXTENSIONS: Record<ReportFormat, string> = { json: "json", markdown: "md" };

/**
 * Writes a report into `dir` (created if missing) under a timestamped name and
 * returns the absolute path. Never overwrites: a same-second collision gets a
 * numeric suffix.
 */
export function writeReportFile(content: string, format: ReportFormat, dir: string, now: Date = new Date()): string {
  const targetDir = resolve(dir);
  ensureDirectory(targetDir);

  const base = `driftline-${timestamp(now)}`;
  const ext = EXTENSIONS[format];
  for (let attempt = 0; ; attempt += 1) {
    const filePath = join(targetDir, `${base}${attempt === 0 ? "" : `-${attempt}`}.${ext}`);
    try {
      writeFileSync(filePath, content, { flag: "wx" });
      return filePath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new CliError(`Could not write report to ${filePath}: ${(err as Error).message}`);
    }
  }
}

function ensureDirectory(dir: string): void {
  try {
    if (!statSync(dir).isDirectory()) {
      throw new CliError(`Cannot save report: ${dir} is a file, not a directory.`);
    }
    return;
  } catch (err) {
    if (err instanceof CliError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new CliError(`Cannot save report to ${dir}: ${(err as Error).message}`);
    }
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new CliError(`Cannot create report directory ${dir}: ${(err as Error).message}`);
  }
}

/** Local time as YYYY-MM-DDTHH-MM-SS (no colons, so the name is valid on every filesystem). */
function timestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}
