import semver from "semver";
import { fetchAdvisories, type Advisory } from "./advisories.ts";
import { rankWorklist } from "./rank.ts";
import { fetchLatestVersion } from "./registry.ts";
import { describeRelease } from "./releases.ts";
import type { InstalledPackage, Severity, WorklistItem } from "./types.ts";

export type { InstalledPackage, WorklistItem, UpdateCategory, Severity } from "./types.ts";
export { rankWorklist } from "./rank.ts";

type FetchLike = typeof fetch;

export interface ScanOptions {
  fetchImpl?: FetchLike;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  unknown: 4,
};

/**
 * The scan engine (PER-10): diffs each installed package's version against
 * the npm registry, pulls release notes + advisories for anything that
 * changed, and returns a ranked worklist — security fix > breaking change >
 * deprecation > minor/feature — for the prompt-generation ticket (PER-12)
 * to consume.
 */
export async function buildWorklist(
  packages: InstalledPackage[],
  options: ScanOptions = {},
): Promise<WorklistItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const items = await Promise.all(packages.map((pkg) => scanPackage(pkg, fetchImpl)));

  return rankWorklist(items.filter((item): item is WorklistItem => item !== null));
}

async function scanPackage(pkg: InstalledPackage, fetchImpl: FetchLike): Promise<WorklistItem | null> {
  if (!pkg.installedVersion) return null; // nothing to diff without a resolved version

  const registryInfo = await fetchLatestVersion(pkg.name, fetchImpl);
  if (!registryInfo) return null;

  const advisories = await fetchAdvisories(pkg.name, pkg.installedVersion, fetchImpl);
  if (advisories.length > 0) {
    const worst = mostSevere(advisories);
    return {
      name: pkg.name,
      currentVersion: pkg.installedVersion,
      latestVersion: registryInfo.latestVersion,
      category: "security",
      severity: worst.severity,
      reason: worst.summary,
      advisoryUrl: worst.url,
    };
  }

  const hasUpdate = isNewerVersion(registryInfo.latestVersion, pkg.installedVersion);
  if (!hasUpdate) return null;

  const base = {
    name: pkg.name,
    currentVersion: pkg.installedVersion,
    latestVersion: registryInfo.latestVersion,
  };

  if (isBreakingBump(registryInfo.latestVersion, pkg.installedVersion)) {
    const release = await describeRelease(registryInfo.repositoryUrl, fetchImpl);
    return {
      ...base,
      category: "breaking",
      reason: release?.reason ?? `Major version bump (${pkg.installedVersion} -> ${registryInfo.latestVersion}).`,
      releaseUrl: release?.releaseUrl,
    };
  }

  if (registryInfo.deprecated) {
    return {
      ...base,
      category: "deprecation",
      reason: registryInfo.deprecated,
    };
  }

  const release = await describeRelease(registryInfo.repositoryUrl, fetchImpl);
  return {
    ...base,
    category: "minor",
    reason: release?.reason ?? `New version available (${pkg.installedVersion} -> ${registryInfo.latestVersion}).`,
    releaseUrl: release?.releaseUrl,
  };
}

function isNewerVersion(latest: string, installed: string): boolean {
  if (semver.valid(latest) && semver.valid(installed)) {
    return semver.gt(latest, installed);
  }
  return latest !== installed;
}

function isBreakingBump(latest: string, installed: string): boolean {
  if (!semver.valid(latest) || !semver.valid(installed)) return false;
  return semver.major(latest) > semver.major(installed);
}

function mostSevere(advisories: Advisory[]): Advisory {
  return [...advisories].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0];
}
