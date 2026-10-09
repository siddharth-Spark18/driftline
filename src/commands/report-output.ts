import type { Command } from "commander";
import { UsageError } from "../lib/errors.ts";
import type { OutputOptions } from "../lib/output.ts";
import { buildJsonReport } from "../report/json.ts";
import { buildMarkdownReport } from "../report/markdown.ts";
import type { ReportData, ReportFormat } from "../report/types.ts";
import { writeReportFile } from "../report/write.ts";
import { promptOutputChoice, type MenuResult, type SaveChoice } from "../ui/menu.ts";

const FORMATS: ReportFormat[] = ["json", "markdown"];

/** Adds the report-saving flags shared by `scan` and `digest`. */
export function addReportOptions(command: Command): Command {
  return command
    .option("--format <format>", "save a report file: json or markdown (skips the interactive menu)")
    .option("--output <path>", "directory to save the report into, created if missing (requires --format; defaults to the current directory)");
}

/**
 * Decides whether and how to save a report, before any slow work starts:
 * flags win and skip the menu; otherwise a real terminal (and not --json) gets
 * the menu; anything else (scripts, cron, CI) saves nothing.
 */
export async function resolveSaveChoice(globalOpts: Record<string, unknown>): Promise<MenuResult> {
  const { format, output } = globalOpts;

  if (format !== undefined && !FORMATS.includes(format as ReportFormat)) {
    throw new UsageError(`--format must be one of ${FORMATS.join(", ")}, got "${String(format)}"`);
  }
  if (output !== undefined && format === undefined) {
    throw new UsageError("--output requires --format (json or markdown)");
  }
  if (typeof output === "string" && output.trim() === "") {
    throw new UsageError("--output must be a non-empty directory path");
  }

  if (format !== undefined) {
    return { format: format as ReportFormat, dir: typeof output === "string" ? output : process.cwd() };
  }

  const interactive = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
  if (!interactive || globalOpts.json) return null;
  return promptOutputChoice();
}

/**
 * Writes the report and says where it went. Nothing is written for an empty
 * worklist. The "saved" line goes to stderr under --json so stdout stays a
 * single JSON document.
 */
export function saveReport(choice: SaveChoice | null, data: ReportData, outputOpts: OutputOptions): void {
  if (!choice || data.worklist.length === 0) return;

  const content = choice.format === "json" ? buildJsonReport(data) : buildMarkdownReport(data);
  const filePath = writeReportFile(content, choice.format, choice.dir);
  const line = `Saved ${choice.format === "json" ? "JSON" : "Markdown"} report to ${filePath}`;
  if (outputOpts.json) console.error(line);
  else console.log(`\n${line}`);
}
