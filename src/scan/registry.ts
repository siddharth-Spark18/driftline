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

function registryUrlFor(name: string): string {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    return `https://registry.npmjs.org/${scope}%2F${pkg}/latest`;
  }
  return `https://registry.npmjs.org/${name}/latest`;
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
