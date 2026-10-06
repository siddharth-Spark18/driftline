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
 * (security > breaking > deprecation > minor). This is what the
 * prompt-generation ticket (PER-12) consumes.
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
}
