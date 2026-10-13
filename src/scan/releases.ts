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

const URL_ONLY = /^(https?:\/\/|www\.)\S+$/i;
const FULL_CHANGELOG = /^full changelog\b/i;

/**
 * Pulls the first meaningful line out of a release body as a short plain-text
 * reason. Skips headings, code blocks, rules, badges, URL-only lines and
 * "Full Changelog" lines; markdown is stripped. Returns null when nothing
 * usable is left, so callers fall back to the generic version-bump reason.
 */
export function summarizeReleaseBody(body: string | null, maxLength = 160): string | null {
  if (!body) return null;

  let inCodeBlock = false;
  for (const raw of body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || line.startsWith("#") || /^([-*_])(\s*\1){2,}$/.test(line)) continue;

    const text = stripMarkdown(line);
    if (!text || URL_ONLY.test(text) || FULL_CHANGELOG.test(text)) continue;
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }
  return null;
}

/** Reduces one markdown line to plain text. Images and badges vanish entirely; links keep their text. */
function stripMarkdown(line: string): string {
  return line
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/!\[[^\]]*\](\([^)]*\)|\[[^\]]*\])?/g, "")
    .replace(/\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g, "$1")
    .replace(/^(>\s*)+/, "")
    .replace(/^([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\*(\S[^*]*)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
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
