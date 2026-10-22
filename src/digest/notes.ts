import { ageText, cooldownMessage, daysSince } from "../scan/cooldown.ts";
import type { SafeVersion, SafeVersions, SkippedSummary, SkipReason } from "../scan/types.ts";

/** Honest limits of what a scan can know, shared by the terminal footer, the Markdown notes and the JSON report. */
export const LIMITS_NOTES: string[] = [
  "Advisory data comes from OSV.dev and can lag: a package compromised very recently may not be listed yet.",
  "Only direct dependencies at their installed version are checked. Transitive dependencies are not scanned.",
  "The version an upgrade would move to is not checked for advisories, and a recent release (see the cooldown note) can still turn out to be bad.",
  "A release-age cooldown lowers risk but proves nothing. A version that is not listed as bad is not guaranteed clean.",
];

/** One line for the terminal footer. */
export const LIMITS_FOOTER =
  "Based on OSV.dev and npm registry data, which can lag. Direct dependencies only; target versions are not checked for advisories, and no version is guaranteed clean.";

const REASON_TEXT: Record<SkipReason, string> = {
  "no-lockfile": "no package-lock.json found",
  "unsupported-lockfile": "a pnpm, yarn or bun lockfile was found, but only package-lock.json is read",
  "lockfile-unreadable": "package-lock.json could not be read",
  "not-in-lockfile": "not found in package-lock.json",
};

const REASON_ORDER: SkipReason[] = ["no-lockfile", "unsupported-lockfile", "lockfile-unreadable", "not-in-lockfile"];

/** "3 of 5 packages were not checked" */
export function skippedHeadline(skipped: SkippedSummary): string {
  const noun = skipped.total === 1 ? "package" : "packages";
  return `${skipped.count} of ${skipped.total} ${noun} ${skipped.count === 1 ? "was" : "were"} NOT checked: no installed version could be resolved.`;
}

/** One line per reason that applies, e.g. "3 x no package-lock.json found". */
export function skippedReasonLines(skipped: SkippedSummary): string[] {
  return REASON_ORDER.filter((reason) => skipped.reasons[reason] > 0).map(
    (reason) => `${skipped.reasons[reason]} x ${REASON_TEXT[reason]}`,
  );
}

/** What the digest says when nothing was reported but something was skipped (never an all-clear). */
export function skippedEmptyText(skipped: SkippedSummary): string {
  return skipped.count >= skipped.total
    ? "No packages could be checked, so there is nothing to report."
    : "Nothing to report for the packages that could be checked.";
}

/** Age and cooldown note for one suggested version. The cooldown wording states that waiting is no proof. */
export function describeSafeVersion(safe: SafeVersion, now: number = Date.now()): string {
  if (safe.cooldown) {
    return `${safe.version} (${cooldownMessage(safe.cooldown.daysOld)}; a wait lowers risk but proves nothing)`;
  }
  const days = daysSince(safe.releasedAt, now);
  return days === undefined ? safe.version : `${safe.version} (published ${ageText(days)})`;
}

/**
 * Plain-text lines for a compromised item's version suggestions. Both values
 * are labeled as information: neither is a guarantee of a clean release.
 */
export function safeVersionLines(safeVersions: SafeVersions | undefined, now: number = Date.now()): string[] {
  if (!safeVersions || safeVersions.lookupFailed) {
    return ["Couldn't determine a known-good version (registry version list unavailable)."];
  }
  const lines: string[] = [];
  if (safeVersions.lastKnownGood) {
    lines.push(`Last known-good before the bad versions: ${describeSafeVersion(safeVersions.lastKnownGood, now)}`);
  }
  if (safeVersions.newestNotListedBad) {
    lines.push(`Newest not listed as bad: ${describeSafeVersion(safeVersions.newestNotListedBad, now)}`);
  }
  return lines;
}
