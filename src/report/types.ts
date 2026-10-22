import type { SkippedSummary, WorklistItem } from "../scan/types.ts";

export type ReportFormat = "json" | "markdown";

/** Everything a saved report is built from: one scan (fresh or cached) plus where it came from. */
export interface ReportData {
  scannedAt: string;
  repo: string;
  driftlineVersion: string;
  /** Items cut by the top-N cap. */
  overflow: number;
  /** Packages that couldn't be checked. Absent for scans cached before this was tracked. */
  skipped?: SkippedSummary;
  worklist: WorklistItem[];
}
