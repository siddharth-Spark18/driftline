import { countByCategory } from "../digest/categories.ts";
import type { ReportData } from "./types.ts";

/** JSON report: scan metadata, per-category counts, and the full worklist (prompts included). */
export function buildJsonReport(data: ReportData): string {
  const counts = countByCategory(data.worklist);
  const report = {
    scannedAt: data.scannedAt,
    repo: data.repo,
    driftlineVersion: data.driftlineVersion,
    overflow: data.overflow,
    summary: { total: data.worklist.length, ...counts },
    worklist: data.worklist,
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
