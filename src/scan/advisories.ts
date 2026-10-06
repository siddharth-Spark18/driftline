import type { Severity } from "./types.ts";

type FetchLike = typeof fetch;

export interface Advisory {
  id: string;
  summary: string;
  severity: Severity;
  url: string;
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
    .map((vuln: Record<string, unknown>) => toAdvisory(vuln))
    .filter((advisory: Advisory | null): advisory is Advisory => advisory !== null);
}

function toAdvisory(vuln: Record<string, unknown>): Advisory | null {
  if (typeof vuln.id !== "string") return null;

  const summary =
    typeof vuln.summary === "string"
      ? vuln.summary
      : typeof vuln.details === "string"
        ? vuln.details.slice(0, 200)
        : "No summary available.";

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
  };
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
