type FetchLike = typeof fetch;

export interface GithubRelease {
  tagName: string;
  htmlUrl: string;
  body: string | null;
}

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** Extracts an owner/repo pair from a package's npm-registry "repository" URL field. */
export function parseGithubRepo(repositoryUrl?: string): GithubRepoRef | null {
  if (!repositoryUrl) return null;
  const match = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** Fetches the latest GitHub release for a repo via the public Releases API. */
export async function fetchLatestRelease(
  repo: GithubRepoRef,
  fetchImpl: FetchLike = fetch,
): Promise<GithubRelease | null> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown };
  if (typeof data.tag_name !== "string" || typeof data.html_url !== "string") return null;

  return {
    tagName: data.tag_name,
    htmlUrl: data.html_url,
    body: typeof data.body === "string" ? data.body : null,
  };
}

/** Pulls the first non-empty, non-heading line out of a release body as a short reason. */
export function summarizeReleaseBody(body: string | null, maxLength = 160): string | null {
  if (!body) return null;
  const firstLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  if (!firstLine) return null;
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 3)}...` : firstLine;
}

export interface ReleaseDescription {
  reason: string;
  releaseUrl: string;
}

/** Resolves a package's repository URL to its latest GitHub release and a short summary. */
export async function describeRelease(
  repositoryUrl: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<ReleaseDescription | null> {
  const repo = parseGithubRepo(repositoryUrl);
  if (!repo) return null;

  const release = await fetchLatestRelease(repo, fetchImpl);
  if (!release) return null;

  const summary = summarizeReleaseBody(release.body);
  return {
    reason: summary ?? `New release: ${release.tagName}.`,
    releaseUrl: release.htmlUrl,
  };
}
