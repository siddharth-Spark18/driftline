import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function extractPatterns(pkg: Record<string, unknown>): string[] | null {
  const ws = pkg.workspaces;
  if (Array.isArray(ws)) {
    return ws.filter((p): p is string => typeof p === "string");
  }
  if (ws && typeof ws === "object") {
    const packages = (ws as Record<string, unknown>).packages;
    if (Array.isArray(packages)) {
      return packages.filter((p): p is string => typeof p === "string");
    }
  }
  return null;
}

function hasPackageJson(absDir: string): boolean {
  try {
    return statSync(join(absDir, "package.json")).isFile();
  } catch {
    return false;
  }
}

function listSubdirs(absDir: string): string[] {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && e.name !== "node_modules").map((e) => e.name);
}

const MAX_RECURSIVE_DEPTH = 5;

/** Supports a single trailing "*" or "**" segment, or a literal (non-glob) path. */
function expandPattern(rootDir: string, pattern: string): string[] {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    const results: string[] = [];
    const walk = (relDir: string, depth: number) => {
      if (depth > MAX_RECURSIVE_DEPTH) return;
      if (hasPackageJson(join(rootDir, relDir))) results.push(relDir);
      for (const name of listSubdirs(join(rootDir, relDir))) {
        walk(join(relDir, name), depth + 1);
      }
    };
    walk(prefix, 0);
    return results;
  }

  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return listSubdirs(join(rootDir, prefix))
      .map((name) => join(prefix, name))
      .filter((relDir) => hasPackageJson(join(rootDir, relDir)));
  }

  return hasPackageJson(join(rootDir, pattern)) ? [pattern] : [];
}

export interface WorkspaceDiscoveryResult {
  memberPaths: string[];
  warnings: string[];
}

/**
 * Resolves the `workspaces` field of a root package.json (npm array form, or the
 * yarn-style `{ packages: [...] }` object form) into concrete member directories,
 * each confirmed to contain its own package.json. Supports "dir/*", "dir/**",
 * literal paths, and "!"-prefixed exclusion patterns.
 */
export function discoverWorkspaceMembers(rootDir: string, rootPkg: Record<string, unknown>): WorkspaceDiscoveryResult {
  const warnings: string[] = [];
  const patterns = extractPatterns(rootPkg);

  if (rootPkg.workspaces !== undefined && patterns === null) {
    warnings.push('"workspaces" field is present but not a recognizable array/packages format, ignoring it.');
    return { memberPaths: [], warnings };
  }

  if (patterns === null || patterns.length === 0) {
    return { memberPaths: [], warnings };
  }

  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const pattern of patterns) {
    const negate = pattern.startsWith("!");
    const bare = negate ? pattern.slice(1) : pattern;
    const matches = expandPattern(rootDir, bare);
    for (const m of matches) {
      (negate ? excluded : included).add(m);
    }
  }

  for (const ex of excluded) included.delete(ex);

  return { memberPaths: [...included].sort(), warnings };
}
