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

/** Shared across one scan run so a rate limit hit by one lookup stops the rest. */
export interface ReleaseLookupState {
  /** Optional GitHub token, raises the API rate limit. */
  token?: string;
  /** Set once GitHub answers 403/429; later lookups are skipped. */
  rateLimited: boolean;
}

/** Extracts an owner/repo pair from a package's npm-registry "repository" URL field. */
export function parseGithubRepo(repositoryUrl?: string): GithubRepoRef | null {
  if (!repositoryUrl) return null;
  const match = repositoryUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Fetches the GitHub release attached to a specific tag. Returns null when the
 * tag has no release, on network failure, or once rate limited (which also
 * flips `state.rateLimited` so the rest of the run skips release notes).
 */
export async function fetchReleaseByTag(
  repo: GithubRepoRef,
  tag: string,
  state: ReleaseLookupState,
  fetchImpl: FetchLike = fetch,
): Promise<GithubRelease | null> {
  if (state.rateLimited) return null;

  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const encodedTag = tag.split("/").map(encodeURIComponent).join("/");
  let res: Response;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${encodedTag}`, {
      headers,
    });
  } catch {
    return null;
  }
  if (res.status === 403 || res.status === 429) {
    state.rateLimited = true;
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

/**
 * Resolves a package's repository URL to the GitHub release for exactly
 * `version`, trying the common tag conventions (`v<ver>`, `<ver>`,
 * `<name>@<ver>`). Returns null when there's no match, so callers fall back to
 * a generic version-bump reason instead of describing an unrelated release.
 */
export async function describeRelease(
  repositoryUrl: string | undefined,
  target: { name: string; version: string },
  state: ReleaseLookupState,
  fetchImpl: FetchLike = fetch,
): Promise<ReleaseDescription | null> {
  const repo = parseGithubRepo(repositoryUrl);
  if (!repo) return null;

  const tags = [`v${target.version}`, target.version, `${target.name}@${target.version}`];
  for (const tag of tags) {
    const release = await fetchReleaseByTag(repo, tag, state, fetchImpl);
    if (state.rateLimited) return null;
    if (!release) continue;

    const summary = summarizeReleaseBody(release.body);
    return {
      reason: summary ?? `New release: ${release.tagName}.`,
      releaseUrl: release.htmlUrl,
    };
  }
  return null;
}
