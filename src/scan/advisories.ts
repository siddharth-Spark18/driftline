import type { Severity } from "./types.ts";

type FetchLike = typeof fetch;

/**
 * `compromised` covers OSV malicious-package entries (`MAL-...`) and advisories
 * tagged CWE-506 (embedded malicious code); everything else is a `vulnerability`.
 */
export type AdvisoryKind = "compromised" | "vulnerability";

/** One affected span from an OSV SEMVER range: `introduced` inclusive, then `fixed` exclusive or `last_affected` inclusive. */
export interface AffectedInterval {
  introduced: string;
  fixed?: string;
  lastAffected?: string;
}

export interface Advisory {
  id: string;
  summary: string;
  severity: Severity;
  url: string;
  kind: AdvisoryKind;
  /** Affected spans for the scanned package only (an advisory can list several packages). */
  intervals: AffectedInterval[];
  /** Every `fixed` version in `intervals`. */
  fixedVersions: string[];
  /** Versions OSV lists explicitly for the scanned package. */
  affectedVersions: string[];
}

/**
 * Queries OSV.dev's public API for known vulnerabilities affecting an
 * installed version. OSV.dev aggregates GitHub Security Advisories (GHSA)
 * along with PyPA, RustSec, etc., so a single free/public query here covers
 * the brief's "OSV.dev and/or GitHub Advisory Database" requirement.
 */
export async function fetchAdvisories(
  name: string,
  version: string,
  fetchImpl: FetchLike = fetch,
): Promise<Advisory[]> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { name, ecosystem: "npm" }, version }),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const data = (await res.json()) as { vulns?: unknown };
  const vulns = Array.isArray(data.vulns) ? data.vulns : [];

  return vulns
    .map((vuln: Record<string, unknown>) => toAdvisory(vuln, name))
    .filter((advisory: Advisory | null): advisory is Advisory => advisory !== null);
}

function toAdvisory(vuln: Record<string, unknown>, packageName: string): Advisory | null {
  if (typeof vuln.id !== "string") return null;

  const summary =
    typeof vuln.summary === "string"
      ? vuln.summary
      : typeof vuln.details === "string"
        ? vuln.details.slice(0, 200)
        : "No summary available.";

  const { intervals, affectedVersions } = readAffected(vuln, packageName);

  const references = Array.isArray(vuln.references) ? vuln.references : [];
  const advisoryRef = references.find(
    (ref): ref is { type: string; url: string } =>
      !!ref && typeof ref === "object" && (ref as { type?: unknown }).type === "ADVISORY",
  );

  return {
    id: vuln.id,
    summary,
    severity: severityOf(vuln),
    url: advisoryRef?.url ?? `https://osv.dev/vulnerability/${vuln.id}`,
    kind: kindOf(vuln),
    intervals,
    fixedVersions: intervals.flatMap((interval) => (interval.fixed ? [interval.fixed] : [])),
    affectedVersions,
  };
}

function kindOf(vuln: Record<string, unknown>): AdvisoryKind {
  if ((vuln.id as string).startsWith("MAL-")) return "compromised";
  const cweIds = (vuln.database_specific as { cwe_ids?: unknown } | undefined)?.cwe_ids;
  return Array.isArray(cweIds) && cweIds.includes("CWE-506") ? "compromised" : "vulnerability";
}

/** Reads the `affected[]` entries for this npm package only, ignoring other packages the advisory lists. */
function readAffected(
  vuln: Record<string, unknown>,
  packageName: string,
): { intervals: AffectedInterval[]; affectedVersions: string[] } {
  const intervals: AffectedInterval[] = [];
  const affectedVersions: string[] = [];
  const affected = Array.isArray(vuln.affected) ? vuln.affected : [];

  for (const entry of affected as Record<string, unknown>[]) {
    const pkg = entry?.package as { name?: unknown; ecosystem?: unknown } | undefined;
    if (!pkg || pkg.name !== packageName || pkg.ecosystem !== "npm") continue;

    if (Array.isArray(entry.versions)) {
      for (const version of entry.versions) if (typeof version === "string") affectedVersions.push(version);
    }
    const ranges = Array.isArray(entry.ranges) ? entry.ranges : [];
    for (const range of ranges as Record<string, unknown>[]) {
      // GIT and ECOSYSTEM ranges don't carry semver-comparable versions.
      if (range?.type !== "SEMVER" || !Array.isArray(range.events)) continue;
      intervals.push(...intervalsFromEvents(range.events as Record<string, unknown>[]));
    }
  }
  return { intervals, affectedVersions };
}

/** Walks OSV events in order: `introduced` opens a span, `fixed` / `last_affected` closes it. */
function intervalsFromEvents(events: Record<string, unknown>[]): AffectedInterval[] {
  const intervals: AffectedInterval[] = [];
  let open: AffectedInterval | null = null;
  for (const event of events) {
    if (typeof event?.introduced === "string") {
      if (open) intervals.push(open);
      open = { introduced: event.introduced };
    } else if (open && typeof event?.fixed === "string") {
      intervals.push({ ...open, fixed: event.fixed });
      open = null;
    } else if (open && typeof event?.last_affected === "string") {
      intervals.push({ ...open, lastAffected: event.last_affected });
      open = null;
    }
  }
  if (open) intervals.push(open);
  return intervals;
}

function severityOf(vuln: Record<string, unknown>): Severity {
  const databaseSpecific = vuln.database_specific as { severity?: unknown } | undefined;
  const raw = databaseSpecific?.severity;
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase();
    if (normalized === "critical" || normalized === "high" || normalized === "moderate" || normalized === "low") {
      return normalized;
    }
  }
  return "unknown";
}
