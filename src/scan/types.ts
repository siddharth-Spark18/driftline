// Input contract: one entry per dependency, as produced by stack ingestion
// (PER-9) when it parses package.json + the npm lockfile. Defined here so the
// scan engine (PER-10) has a stable shape to build against while PER-9 lands.
export interface InstalledPackage {
  name: string;
  declaredRange: string;
  dev: boolean;
  /** `null` when no installed version could be resolved (e.g. no lockfile). */
  installedVersion: string | null;
}

export type UpdateCategory = "security" | "breaking" | "deprecation" | "minor";

export type Severity = "critical" | "high" | "moderate" | "low" | "unknown";

/**
 * Output contract: one entry per package with a change, ranked by priority
 * (security > breaking > deprecation > minor). The optional fields added by
 * PER-12 are additive, so older cached `last-scan.json` files stay readable.
 */
export interface WorklistItem {
  name: string;
  currentVersion: string;
  latestVersion: string;
  category: UpdateCategory;
  severity?: Severity;
  reason: string;
  releaseUrl?: string;
  advisoryUrl?: string;
  /** Files that reference this package, found by local regex detection. Absent when detection didn't run. */
  affectedFiles?: AffectedFile[];
  /** `false` when detection ran and found no file referencing the package. */
  usageDetected?: boolean;
  /** ISO publish date of `latestVersion` from the npm registry `time` field. */
  releasedAt?: string;
  /** Set when `latestVersion` is younger than the cooldown window. Flag only: never demotes or hides the item. */
  cooldown?: { daysOld: number };
  /** Ready-to-paste agent prompt. Only built for security, breaking and deprecation items. */
  prompt?: string;
}

export type UsageConfidence = "high" | "medium" | "low";

export interface AffectedFile {
  /** Path relative to the scanned repo root, with forward slashes. */
  path: string;
  confidence: UsageConfidence;
}
