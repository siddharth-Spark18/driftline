// Input contract: one entry per dependency, as produced by stack ingestion
// (PER-9) when it parses package.json + the npm lockfile. Defined here so the
// scan engine (PER-10) has a stable shape to build against while PER-9 lands.
export interface InstalledPackage {
  name: string;
  declaredRange: string;
  dev: boolean;
  /** `null` when no installed version could be resolved (e.g. no lockfile). */
  installedVersion: string | null;
  /** Why `installedVersion` is `null`. Absent when it resolved. */
  skipReason?: SkipReason;
}

/** Why a package couldn't be checked for lack of an installed version. */
export type SkipReason = "no-lockfile" | "unsupported-lockfile" | "lockfile-unreadable" | "not-in-lockfile";

/** Packages that were not checked because no installed version could be resolved. */
export interface SkippedSummary {
  /** Packages without a resolved version. */
  count: number;
  /** Packages considered by the scan, checked or not. */
  total: number;
  reasons: Record<SkipReason, number>;
}

export type UpdateCategory = "compromised" | "security" | "breaking" | "deprecation" | "minor";

export type Severity = "critical" | "high" | "moderate" | "low" | "unknown";

/**
 * Output contract: one entry per package with a change, ranked by priority
 * (compromised > security > breaking > deprecation > minor). The optional fields added by
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
  /** Set when the package is on `preferences.ignorePackages` but has a known advisory, so it is shown anyway. */
  ignored?: boolean;
  /** Ready-to-paste agent prompt. Only built for compromised, security, breaking and deprecation items. */
  prompt?: string;
  /** Security items: lowest version that fixes every advisory, in the installed release line when one exists. */
  fixedVersion?: string;
  /** `true` when `fixedVersion` is outside the installed release line (a major upgrade, or a minor one for 0.x). */
  fixNeedsMajorUpgrade?: boolean;
  /** `true` when an advisory affecting the installed version has no published fix. */
  noFixPublished?: boolean;
  /** OSV ids of the advisories behind this item (compromised: the malicious-package ones). */
  advisoryIds?: string[];
  /** Compromised items: ordinary vulnerability advisories also affecting the installed version (counted, not listed). */
  otherAdvisoryCount?: number;
  /** Compromised items only: versions worth considering, derived from the registry's version list. */
  safeVersions?: SafeVersions;
}

export interface SafeVersion {
  version: string;
  /** ISO publish date from the registry `time` map. */
  releasedAt?: string;
  /** Set when this version is younger than the cooldown window. */
  cooldown?: { daysOld: number };
}

/** Information, not a guarantee: neither value is proven clean, they are just not listed as bad by OSV. */
export interface SafeVersions {
  /** Highest stable version below the lowest bad one. */
  lastKnownGood?: SafeVersion;
  /** Highest stable version not listed as bad. */
  newestNotListedBad?: SafeVersion;
  /** The registry version list couldn't be fetched, or held no usable version. */
  lookupFailed?: boolean;
}

export type UsageConfidence = "high" | "medium" | "low";

export interface AffectedFile {
  /** Path relative to the scanned repo root, with forward slashes. */
  path: string;
  confidence: UsageConfidence;
}
