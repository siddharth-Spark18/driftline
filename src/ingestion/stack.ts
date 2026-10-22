import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../lib/errors.ts";
import type { InstalledPackage, SkipReason } from "../scan/types.ts";
import { discoverWorkspaceMembers } from "./workspaces.ts";

export interface StackIngestionResult {
  packages: InstalledPackage[];
  warnings: string[];
}

/**
 * Reads package.json + package-lock.json from `repoPath` and returns the
 * normalized `InstalledPackage[]` the scan engine (PER-10) builds a worklist
 * from. Supports npm workspaces (reads each member's own package.json too)
 * and npm lockfile v2/v3 for resolving actually-installed versions.
 *
 * Throws UsageError when there's nothing to scan at all (missing/malformed
 * root package.json) — anything else recoverable (missing/malformed lockfile,
 * a bad workspace member, partial package.json) is reported via `warnings`
 * instead, so one bad file doesn't abort the whole scan.
 */
export function ingestStack(repoPath: string): StackIngestionResult {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) {
    throw new UsageError(`No package.json found at ${pkgPath}`);
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (err) {
    throw new UsageError(`package.json at ${pkgPath} is not valid JSON: ${(err as Error).message}`);
  }

  const warnings: string[] = [];

  const declared = new Map<string, { range: string; dev: boolean }>();
  collectRanges(pkg.dependencies, false, declared);
  collectRanges(pkg.devDependencies, true, declared);

  // Monorepo/workspaces: pull in each member's own declared dependencies too. A member
  // declaration never overrides a root one (first-seen wins, same as the dependencies ->
  // devDependencies priority above).
  const discovery = discoverWorkspaceMembers(repoPath, pkg);
  warnings.push(...discovery.warnings);

  const memberPackages: Record<string, unknown>[] = [];
  for (const memberPath of discovery.memberPaths) {
    const memberPkgPath = join(repoPath, memberPath, "package.json");
    let memberPkg: Record<string, unknown>;
    try {
      memberPkg = JSON.parse(readFileSync(memberPkgPath, "utf8"));
    } catch (err) {
      warnings.push(
        `Workspace member "${memberPath}": package.json is not valid JSON (${(err as Error).message}), skipping it.`,
      );
      continue;
    }
    memberPackages.push(memberPkg);
    collectRanges(memberPkg.dependencies, false, declared);
    collectRanges(memberPkg.devDependencies, true, declared);
  }

  const { installed, status } = readLockfileVersions(repoPath, warnings);

  // Cross-package deps within a monorepo (e.g. one member depending on a sibling member)
  // resolve via an npm `link` entry with no version in the lockfile; fall back to that
  // sibling's own declared version.
  const localVersions = new Map<string, string>();
  for (const candidate of [pkg, ...memberPackages]) {
    if (typeof candidate.name === "string" && typeof candidate.version === "string") {
      localVersions.set(candidate.name, candidate.version);
    }
  }

  const packages: InstalledPackage[] = [...declared.entries()]
    .map(([name, { range, dev }]): InstalledPackage => {
      const installedVersion = installed.get(name) ?? localVersions.get(name) ?? null;
      return {
        name,
        declaredRange: range,
        dev,
        installedVersion,
        // Recorded so the scan can say why a package wasn't checked.
        ...(installedVersion === null ? { skipReason: SKIP_REASON_BY_STATUS[status] } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { packages, warnings };
}

function collectRanges(section: unknown, dev: boolean, into: Map<string, { range: string; dev: boolean }>): void {
  if (!section || typeof section !== "object") return;
  for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
    if (typeof range !== "string") continue;
    if (into.has(name)) continue; // dependencies wins over devDependencies, and root wins over members
    into.set(name, { range, dev });
  }
}

type LockfileStatus = "ok" | "missing" | "unsupported" | "unreadable";

const SKIP_REASON_BY_STATUS: Record<LockfileStatus, SkipReason> = {
  ok: "not-in-lockfile",
  missing: "no-lockfile",
  unsupported: "unsupported-lockfile",
  unreadable: "lockfile-unreadable",
};

// Lockfiles from other package managers: detected only to explain why nothing could be resolved.
const OTHER_LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];

function readLockfileVersions(
  repoPath: string,
  warnings: string[],
): { installed: Map<string, string>; status: LockfileStatus } {
  const lockPath = join(repoPath, "package-lock.json");
  const installed = new Map<string, string>();

  if (!existsSync(lockPath)) {
    const other = OTHER_LOCKFILES.find((file) => existsSync(join(repoPath, file)));
    if (other) {
      warnings.push(
        `Found ${other}, but Driftline only reads package-lock.json — packages without an installed version are skipped, not checked.`,
      );
      return { installed, status: "unsupported" };
    }
    warnings.push("No package-lock.json found — packages without an installed version are skipped, not checked.");
    return { installed, status: "missing" };
  }

  let lock: Record<string, unknown>;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (err) {
    warnings.push(
      `package-lock.json is not valid JSON (${(err as Error).message}) — packages without an installed version are skipped, not checked.`,
    );
    return { installed, status: "unreadable" };
  }

  const lockfileVersion = typeof lock.lockfileVersion === "number" ? lock.lockfileVersion : 0;

  if (lockfileVersion >= 2 && lock.packages && typeof lock.packages === "object") {
    // npm lockfile v2/v3: keys are paths like "node_modules/foo", "node_modules/@scope/foo",
    // or nested "node_modules/a/node_modules/foo" for non-hoisted deps (version conflicts).
    // Workspace member entries (e.g. "packages/foo", with no "node_modules/" prefix) are
    // skipped here on purpose — see the `localVersions` fallback in ingestStack.
    for (const [path, meta] of Object.entries(lock.packages as Record<string, unknown>)) {
      if (!path.startsWith("node_modules/")) continue;
      const segments = path.split("node_modules/").filter(Boolean);
      const name = segments[segments.length - 1];
      const version = (meta as { version?: unknown })?.version;
      if (!name || typeof version !== "string") continue;
      // Prefer the top-level hoisted resolution over a nested, non-hoisted one.
      if (!installed.has(name) || segments.length === 1) {
        installed.set(name, version);
      }
    }
  } else if (lock.dependencies && typeof lock.dependencies === "object") {
    // npm lockfile v1 fallback.
    for (const [name, meta] of Object.entries(lock.dependencies as Record<string, unknown>)) {
      const version = (meta as { version?: unknown })?.version;
      if (typeof version === "string") installed.set(name, version);
    }
  } else {
    warnings.push(
      "package-lock.json format not recognized — packages without an installed version are skipped, not checked.",
    );
    return { installed, status: "unreadable" };
  }

  return { installed, status: "ok" };
}
