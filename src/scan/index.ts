import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { buildPrompt, findVerifyScripts } from "../prompt/build.ts";
import { fetchAdvisories, type Advisory } from "./advisories.ts";
import { computeCooldown } from "./cooldown.ts";
import { rankWorklist } from "./rank.ts";
import { fetchLatestVersion, fetchPublishTime } from "./registry.ts";
import { describeRelease, type ReleaseLookupState } from "./releases.ts";
import type { InstalledPackage, Severity, WorklistItem } from "./types.ts";
import { detectUsage } from "./usage.ts";

export type { InstalledPackage, WorklistItem, UpdateCategory, Severity } from "./types.ts";
export { rankWorklist, capWorklist } from "./rank.ts";

type FetchLike = typeof fetch;

export interface ScanOptions {
  fetchImpl?: FetchLike;
  /** Repo to run affected-file detection and prompt generation against. Both are skipped when omitted. */
  repoPath?: string;
  /** Latest releases younger than this many days are flagged (never held back). Default 3; 0 disables. */
  cooldownDays?: number;
  /** Optional GitHub token for release lookups. */
  githubToken?: string;
  /** Receives non-fatal problems (e.g. GitHub rate limiting) so the caller decides how to surface them. */
  onWarning?: (message: string) => void;
  /** Receives a short label as each scan phase begins, so a caller can show progress. */
  onProgress?: (step: string) => void;
}

const DEFAULT_COOLDOWN_DAYS = 3;

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

  const cooldownDays = options.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;
  const releaseState: ReleaseLookupState = { token: options.githubToken, rateLimited: false };

  options.onProgress?.(`Checking ${packages.length} ${packages.length === 1 ? "package" : "packages"} against the registry and advisories`);
  const scanned = await Promise.all(packages.map((pkg) => scanPackage(pkg, fetchImpl, releaseState)));
  const items = scanned.filter((item): item is WorklistItem => item !== null);

  if (releaseState.rateLimited) {
    options.onWarning?.(
      "GitHub rate limit hit (set GITHUB_TOKEN or apiKeys.github to raise it) — skipped release notes for the remaining packages.",
    );
  }

  if (items.length > 0) options.onProgress?.("Looking up release dates");
  await Promise.all(
    items.map(async (item) => {
      item.releasedAt = await fetchPublishTime(item.name, item.latestVersion, fetchImpl);
      const cooldown = computeCooldown(item.releasedAt, cooldownDays);
      if (cooldown) item.cooldown = cooldown;
    }),
  );
  for (const item of items) {
    if (!item.releasedAt) delete item.releasedAt;
  }

  if (options.repoPath && items.length > 0) options.onProgress?.("Detecting affected files and building prompts");
  if (options.repoPath) attachUsageAndPrompts(options.repoPath, items);

  return rankWorklist(items);
}

/** Runs one detection pass for every item, then builds prompts for the actionable ones. */
function attachUsageAndPrompts(repoPath: string, items: WorklistItem[]): void {
  if (items.length === 0) return;

  const usage = detectUsage(
    repoPath,
    items.map((item) => item.name),
  );
  const context = { verifyScripts: readVerifyScripts(repoPath) };

  for (const item of items) {
    item.affectedFiles = usage.get(item.name) ?? [];
    item.usageDetected = item.affectedFiles.length > 0;
    const prompt = buildPrompt(item, context);
    if (prompt) item.prompt = prompt;
  }
}

function readVerifyScripts(repoPath: string): string[] {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return [];
  try {
    return findVerifyScripts((JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: unknown }).scripts);
  } catch {
    return [];
  }
}

async function scanPackage(
  pkg: InstalledPackage,
  fetchImpl: FetchLike,
  releaseState: ReleaseLookupState,
): Promise<WorklistItem | null> {
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
    const release = await describeRelease(
      registryInfo.repositoryUrl,
      { name: pkg.name, version: registryInfo.latestVersion },
      releaseState,
      fetchImpl,
    );
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

  const release = await describeRelease(
    registryInfo.repositoryUrl,
    { name: pkg.name, version: registryInfo.latestVersion },
    releaseState,
    fetchImpl,
  );
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
