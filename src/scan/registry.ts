export interface RegistryInfo {
  latestVersion: string;
  deprecated?: string;
  repositoryUrl?: string;
}

type FetchLike = typeof fetch;

interface LatestVersionDoc {
  version?: unknown;
  deprecated?: unknown;
  repository?: unknown;
}

function registryUrlFor(name: string, suffix = "/latest"): string {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return `https://registry.npmjs.org/${scope}%2F${pkg}${suffix}`;
  }
  return `https://registry.npmjs.org/${name}${suffix}`;
}

/**
 * Looks up a package's latest published version via the public npm registry API.
 *
 * Fetches the `/latest` version document directly rather than the full packument:
 * the abbreviated packument format (`Accept: vnd.npm.install-v1+json`) strips the
 * `repository` field entirely, which silently breaks GitHub release-note lookup,
 * and the full packument includes every published version's metadata (multi-MB
 * for popular packages) just to read the one version we need.
 */
export async function fetchLatestVersion(name: string, fetchImpl: FetchLike = fetch): Promise<RegistryInfo | null> {
  let res: Response;
  try {
    res = await fetchImpl(registryUrlFor(name));
  } catch {
    return null; // network failure — treat as "no data available" rather than crashing the scan
  }
  if (!res.ok) return null;

  const data = (await res.json()) as LatestVersionDoc;
  const latestVersion = data.version;
  if (typeof latestVersion !== "string") return null;

  const repoField = data.repository as string | { url?: unknown } | undefined;
  const repositoryUrl = typeof repoField === "string" ? repoField : repoField?.url;

  return {
    latestVersion,
    deprecated: typeof data.deprecated === "string" ? data.deprecated : undefined,
    repositoryUrl: typeof repositoryUrl === "string" ? repositoryUrl : undefined,
  };
}

/**
 * Looks up when a specific version was published. The `time` map only exists on
 * the full packument (the `/latest` document omits it), so this is a separate,
 * heavier request made only for packages that already made it onto the worklist.
 * Returns an ISO string, or `undefined` when unavailable or unparseable.
 */
export async function fetchPublishTime(
  name: string,
  version: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | undefined> {
  let res: Response;
  try {
    res = await fetchImpl(registryUrlFor(name, ""));
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;

  let data: { time?: Record<string, unknown> };
  try {
    data = (await res.json()) as { time?: Record<string, unknown> };
  } catch {
    return undefined;
  }
  const published = data.time?.[version];
  if (typeof published !== "string" || Number.isNaN(Date.parse(published))) return undefined;
  return new Date(published).toISOString();
}
