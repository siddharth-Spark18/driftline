import type { WorklistItem } from "../scan/types.ts";

export type ReportFormat = "json" | "markdown";

/** Everything a saved report is built from: one scan (fresh or cached) plus where it came from. */
export interface ReportData {
  scannedAt: string;
  repo: string;
  driftlineVersion: string;
  /** Items cut by the top-N cap. */
  overflow: number;
  worklist: WorklistItem[];
}
