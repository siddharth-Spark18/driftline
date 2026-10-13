/**
 * Builds a matcher for `preferences.ignorePackages`. Each entry is an exact
 * package name or a simple glob where `*` matches any run of characters except
 * `/` (so `@types/*` matches `@types/node` and `eslint-*` matches `eslint-plugin-x`).
 * Matched against package names only.
 */
export function createIgnoreMatcher(patterns: string[]): (name: string) => boolean {
  const exact = new Set<string>();
  const globs: RegExp[] = [];

  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const source = pattern.split("*").map(escapeRegExp).join("[^/]*");
      globs.push(new RegExp(`^${source}$`));
    } else {
      exact.add(pattern);
    }
  }

  return (name) => exact.has(name) || globs.some((glob) => glob.test(name));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
