import semver from "semver";
import { computeCooldown } from "./cooldown.ts";
import type { Advisory, AffectedInterval } from "./advisories.ts";
import type { SafeVersions } from "./types.ts";

export interface FixChoice {
  fixedVersion?: string;
  fixNeedsMajorUpgrade?: boolean;
  noFixPublished?: boolean;
}

function lowerBound(introduced: string): string {
  return introduced === "0" ? "0.0.0" : introduced;
}

function inInterval(version: string, interval: AffectedInterval): boolean {
  const start = lowerBound(interval.introduced);
  if (!semver.valid(start) || !semver.gte(version, start)) return false;
  if (interval.fixed) return semver.valid(interval.fixed) ? semver.lt(version, interval.fixed) : false;
  if (interval.lastAffected) return semver.valid(interval.lastAffected) ? semver.lte(version, interval.lastAffected) : false;
  return true;
}

/** Whether OSV lists `version` as affected, by explicit version list or by SEMVER range. */
export function isAffected(version: string, advisory: Advisory): boolean {
  if (advisory.affectedVersions.includes(version)) return true;
  if (!semver.valid(version)) return false;
  return advisory.intervals.some((interval) => inInterval(version, interval));
}

function sameLine(a: string, b: string): boolean {
  if (semver.major(a) !== semver.major(b)) return false;
  return semver.major(a) !== 0 || semver.minor(a) === semver.minor(b);
}

/**
 * Lowest version that fixes every advisory affecting `installed`. Prefers the
 * installed release line (same major; same minor for 0.x); otherwise the lowest
 * higher fix, flagged as needing a major upgrade. No claim is made when the
 * installed version is unparsable, an advisory can't be placed on a range, or
 * an advisory has no published fix.
 */
export function chooseFix(installed: string, advisories: Advisory[]): FixChoice {
  if (!semver.valid(installed) || advisories.length === 0) return {};

  const candidates = new Set<string>();
  let noFix = false;
  for (const advisory of advisories) {
    const containing = advisory.intervals.filter((interval) => inInterval(installed, interval));
    if (containing.length === 0) return {}; // listed by explicit version only: can't place a fix
    for (const interval of containing) {
      if (interval.fixed && semver.valid(interval.fixed)) candidates.add(interval.fixed);
      else noFix = true;
    }
  }
  if (noFix) return { noFixPublished: true };

  const valid = [...candidates]
    // Prereleases are never recommended as a fix (unless the user is already on one).
    .filter((candidate) => semver.gt(candidate, installed) && (!semver.prerelease(candidate) || Boolean(semver.prerelease(installed))))
    .filter((candidate) => !advisories.some((advisory) => isAffected(candidate, advisory)))
    .sort(semver.compare);
  const inLine = valid.find((candidate) => sameLine(candidate, installed));
  if (inLine) return { fixedVersion: inLine };
  if (valid.length > 0) return { fixedVersion: valid[0], fixNeedsMajorUpgrade: true };
  return {};
}

/**
 * From the registry's version list, picks the versions worth considering for a
 * compromised package. "Bad" means the installed version or anything a
 * compromised advisory lists. Neither pick is proven clean; they are only not
 * listed as bad. Prereleases are never picked.
 */
export function chooseSafeVersions(
  versions: string[],
  times: Record<string, string>,
  installed: string,
  compromised: Advisory[],
  cooldownDays: number,
  now: number = Date.now(),
): SafeVersions {
  const valid = versions.filter((version) => semver.valid(version)).sort(semver.compare);
  const isBad = (version: string) => version === installed || compromised.some((advisory) => isAffected(version, advisory));
  const bad = valid.filter(isBad);
  const stableGood = valid.filter((version) => !semver.prerelease(version) && !isBad(version));

  const describe = (version: string) => {
    const releasedAt = times[version];
    const cooldown = computeCooldown(releasedAt, cooldownDays, now);
    return { version, ...(releasedAt ? { releasedAt } : {}), ...(cooldown ? { cooldown } : {}) };
  };

  const newest = stableGood[stableGood.length - 1];
  const lowestBad = bad[0] ?? (semver.valid(installed) ? installed : undefined);
  const beforeBad = lowestBad ? stableGood.filter((version) => semver.lt(version, lowestBad)) : [];
  const lastGood = beforeBad[beforeBad.length - 1];

  if (!newest && !lastGood) return { lookupFailed: true };
  return {
    ...(lastGood ? { lastKnownGood: describe(lastGood) } : {}),
    ...(newest ? { newestNotListedBad: describe(newest) } : {}),
  };
}
