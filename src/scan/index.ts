import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { buildPrompt, findVerifyScripts } from "../prompt/build.ts";
import { fetchAdvisories, type Advisory } from "./advisories.ts";
import { computeCooldown } from "./cooldown.ts";
import { chooseFix, chooseSafeVersions } from "./fixes.ts";
import { createIgnoreMatcher } from "./ignore.ts";
import { loadPublishCache, publishCacheKey, savePublishCache, type PublishTimes } from "./publish-cache.ts";
import { capWorklist, rankWorklist } from "./rank.ts";
import { fetchLatestVersion, fetchPublishTime, fetchVersionList } from "./registry.ts";
import { describeRelease, type ReleaseLookupState } from "./releases.ts";
import type { InstalledPackage, SkippedSummary, SkipReason, Severity, WorklistItem } from "./types.ts";
import { detectUsage } from "./usage.ts";

export type { InstalledPackage, WorklistItem, UpdateCategory, Severity, SkippedSummary, SkipReason } from "./types.ts";
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
  /** Package names or simple globs (`@types/*`) to hide. They skip registry and release lookups; a known advisory is still reported. */
  ignorePackages?: string[];
  /** Top-N cap applied before the publish-time lookup and usage detection. Security items are never dropped. Uncapped when omitted. */
  maxItems?: number;
  /** Disk cache file for publish times. No caching when omitted. */
  publishCachePath?: string;
}

export interface ScanResult {
  /** Ranked, and capped when `maxItems` was given. */
  items: WorklistItem[];
  /** Items cut by the cap. */
  overflow: number;
  /** Packages hidden by the ignore list (ignored packages shown because of an advisory are not counted). */
  ignored: number;
  /** Packages that couldn't be checked for lack of an installed version. */
  skipped: SkippedSummary;
}

/** Per-scan state shared by every `scanPackage` call. */
interface ScanContext {
  fetchImpl: FetchLike;
  releaseState: ReleaseLookupState;
  cooldownDays: number;
  /** Publish times already seen in a version list (compromised items), so they aren't fetched twice. */
  knownTimes: PublishTimes;
}

const DEFAULT_COOLDOWN_DAYS = 3;

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  unknown: 4,
};

/** The ranked (uncapped unless `maxItems` is set) worklist; see `runScan` for the overflow and ignore counts. */
export async function buildWorklist(
  packages: InstalledPackage[],
  options: ScanOptions = {},
): Promise<WorklistItem[]> {
  return (await runScan(packages, options)).items;
}

/**
 * The scan engine (PER-10): diffs each installed package's version against
 * the npm registry, pulls release notes + advisories for anything that
 * changed, and returns a ranked worklist — security fix > breaking change >
 * deprecation > minor/feature — for the prompt-generation ticket (PER-12)
 * to consume. The cap runs before the per-item publish-time lookup, so only
 * the items that will be shown cost an extra request.
 */
export async function runScan(packages: InstalledPackage[], options: ScanOptions = {}): Promise<ScanResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const cooldownDays = options.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;
  const releaseState: ReleaseLookupState = { token: options.githubToken, rateLimited: false };
  const isIgnored = createIgnoreMatcher(options.ignorePackages ?? []);

  options.onProgress?.(`Checking ${packages.length} ${packages.length === 1 ? "package" : "packages"} against the registry and advisories`);
  const context: ScanContext = { fetchImpl, releaseState, cooldownDays, knownTimes: {} };
  const scanned = await Promise.all(packages.map((pkg) => scanPackage(pkg, context, isIgnored(pkg.name))));
  const found = scanned.filter((item): item is WorklistItem => item !== null);
  const ignored = packages.filter((pkg) => isIgnored(pkg.name)).length - found.filter((item) => item.ignored).length;

  if (releaseState.rateLimited) {
    options.onWarning?.(
      "GitHub rate limit hit (set GITHUB_TOKEN or apiKeys.github to raise it) — skipped release notes for the remaining packages.",
    );
  }

  const ranked = rankWorklist(found);
  const { items, overflow } = options.maxItems === undefined ? { items: ranked, overflow: 0 } : capWorklist(ranked, options.maxItems);

  await attachPublishTimes(items, cooldownDays, fetchImpl, options, context.knownTimes);

  if (options.repoPath && items.length > 0) options.onProgress?.("Detecting affected files and building prompts");
  if (options.repoPath) attachUsageAndPrompts(options.repoPath, items);

  return { items, overflow, ignored, skipped: summarizeSkipped(packages) };
}

function summarizeSkipped(packages: InstalledPackage[]): SkippedSummary {
  const reasons: Record<SkipReason, number> = {
    "no-lockfile": 0,
    "unsupported-lockfile": 0,
    "lockfile-unreadable": 0,
    "not-in-lockfile": 0,
  };
  let count = 0;
  for (const pkg of packages) {
    if (pkg.installedVersion) continue;
    reasons[pkg.skipReason ?? "no-lockfile"] += 1;
    count += 1;
  }
  return { count, total: packages.length, reasons };
}

/** Looks up publish times (disk cache first) and flags young releases. Ignored items never reach the registry. */
async function attachPublishTimes(
  items: WorklistItem[],
  cooldownDays: number,
  fetchImpl: FetchLike,
  options: ScanOptions,
  knownTimes: PublishTimes,
): Promise<void> {
  const lookups = items.filter((item) => !item.ignored);
  if (lookups.length > 0) options.onProgress?.("Looking up release dates");

  const cached: PublishTimes = options.publishCachePath ? loadPublishCache(options.publishCachePath) : {};
  const fresh: PublishTimes = {};
  await Promise.all(
    lookups.map(async (item) => {
      const key = publishCacheKey(item.name, item.latestVersion);
      const releasedAt = cached[key] ?? knownTimes[key] ?? (await fetchPublishTime(item.name, item.latestVersion, fetchImpl));
      if (!releasedAt) return;

      // Only successful, parseable times are cached; failures are retried next run.
      if (!(key in cached)) fresh[key] = releasedAt;
      item.releasedAt = releasedAt;
      const cooldown = computeCooldown(releasedAt, cooldownDays);
      if (cooldown) item.cooldown = cooldown;
    }),
  );
  if (options.publishCachePath) savePublishCache(options.publishCachePath, fresh);
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
    // An ignored package is only shown for its advisory; no upgrade task is generated for it
    // (a compromised one still gets its remediation prompt).
    const prompt = item.ignored && item.category !== "compromised" ? null : buildPrompt(item, context);
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

async function scanPackage(pkg: InstalledPackage, context: ScanContext, ignored: boolean): Promise<WorklistItem | null> {
  if (!pkg.installedVersion) return null; // nothing to diff without a resolved version
  const { fetchImpl, releaseState } = context;

  // Ignored packages skip the registry and release lookups, but a known advisory is still worth showing.
  if (ignored) {
    const advisories = await fetchAdvisories(pkg.name, pkg.installedVersion, fetchImpl);
    if (advisories.length === 0) return null;
    const compromised = await compromisedItem(pkg.name, pkg.installedVersion, pkg.installedVersion, advisories, context);
    if (compromised) return { ...compromised, ignored: true };
    const worst = mostSevere(advisories);
    return {
      name: pkg.name,
      currentVersion: pkg.installedVersion,
      latestVersion: pkg.installedVersion, // not looked up for ignored packages
      category: "security",
      severity: worst.severity,
      reason: worst.summary,
      advisoryUrl: worst.url,
      advisoryIds: advisories.map((advisory) => advisory.id),
      ...chooseFix(pkg.installedVersion, advisories),
      ignored: true,
    };
  }

  const registryInfo = await fetchLatestVersion(pkg.name, fetchImpl);
  if (!registryInfo) {
    // A registry miss drops ordinary items, but a known-malicious version must still be shown.
    const advisories = await fetchAdvisories(pkg.name, pkg.installedVersion, fetchImpl);
    return compromisedItem(pkg.name, pkg.installedVersion, pkg.installedVersion, advisories, context);
  }

  const advisories = await fetchAdvisories(pkg.name, pkg.installedVersion, fetchImpl);
  if (advisories.length > 0) {
    const compromised = await compromisedItem(pkg.name, pkg.installedVersion, registryInfo.latestVersion, advisories, context);
    if (compromised) return compromised;

    const worst = mostSevere(advisories);
    return {
      name: pkg.name,
      currentVersion: pkg.installedVersion,
      latestVersion: registryInfo.latestVersion,
      category: "security",
      severity: worst.severity,
      reason: worst.summary,
      advisoryUrl: worst.url,
      advisoryIds: advisories.map((advisory) => advisory.id),
      ...chooseFix(pkg.installedVersion, advisories),
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

/**
 * Builds the compromised item when any advisory is a malicious-package one;
 * compromised wins over ordinary vulnerabilities, which are only counted. The
 * registry version list is fetched here and nowhere else.
 */
async function compromisedItem(
  name: string,
  installed: string,
  latestVersion: string,
  advisories: Advisory[],
  context: ScanContext,
): Promise<WorklistItem | null> {
  const malicious = advisories.filter((advisory) => advisory.kind === "compromised");
  if (malicious.length === 0) return null;

  const versionList = await fetchVersionList(name, context.fetchImpl);
  if (versionList) {
    for (const [version, releasedAt] of Object.entries(versionList.times)) {
      context.knownTimes[publishCacheKey(name, version)] = releasedAt;
    }
  }
  const safeVersions = versionList
    ? chooseSafeVersions(versionList.versions, versionList.times, installed, malicious, context.cooldownDays)
    : { lookupFailed: true };

  return {
    name,
    currentVersion: installed,
    latestVersion,
    category: "compromised",
    reason: malicious[0].summary,
    advisoryUrl: malicious[0].url,
    advisoryIds: malicious.map((advisory) => advisory.id),
    otherAdvisoryCount: advisories.length - malicious.length,
    safeVersions,
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
