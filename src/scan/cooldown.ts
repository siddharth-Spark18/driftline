const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Flags a release younger than the cooldown window. A missing/unparseable
 * publish date, or a window of 0, yields no flag.
 */
export function computeCooldown(
  releasedAt: string | undefined,
  cooldownDays: number,
  now: number = Date.now(),
): { daysOld: number } | undefined {
  if (!releasedAt || cooldownDays <= 0) return undefined;
  const published = Date.parse(releasedAt);
  if (Number.isNaN(published)) return undefined;

  const daysOld = Math.max(0, Math.floor((now - published) / DAY_MS));
  return daysOld < cooldownDays ? { daysOld } : undefined;
}

/** Whole days since `releasedAt`, or `undefined` when missing or unparseable. */
export function daysSince(releasedAt: string | undefined, now: number = Date.now()): number | undefined {
  if (!releasedAt) return undefined;
  const published = Date.parse(releasedAt);
  if (Number.isNaN(published)) return undefined;
  return Math.max(0, Math.floor((now - published) / DAY_MS));
}

/** "today" / "1 day ago" / "N days ago". */
export function ageText(daysOld: number): string {
  return daysOld === 0 ? "today" : daysOld === 1 ? "1 day ago" : `${daysOld} days ago`;
}

/** Shared flag text for the terminal report and the agent prompt. */
export function cooldownMessage(daysOld: number): string {
  return `released ${ageText(daysOld)}, consider waiting`;
}
