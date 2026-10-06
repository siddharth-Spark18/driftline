import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolves the repo the CLI should operate on: --repo flag, else the cwd it was invoked from. */
export function resolveTargetRepo(repoOption?: string): string {
  return resolve(repoOption ?? process.cwd());
}

/** Project-local config: preferences devs may want to check into the scanned repo (never secrets). */
export function projectConfigPath(repoPath: string): string {
  return join(repoPath, ".learningradarrc.json");
}

export function globalConfigDir(): string {
  return join(homedir(), ".config", "learning-radar");
}

/** Global config: API keys and machine-wide preferences, outside any scanned repo so they can't be committed by accident. */
export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

interface PackageMetadata {
  name: string;
  version: string;
}

/** Reads this CLI's own package.json for --version output, resolved relative to this compiled file. */
export function readOwnPackageJson(): PackageMetadata {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, "..", "..", "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<PackageMetadata>;
  return { name: parsed.name ?? "learning-radar", version: parsed.version ?? "0.0.0" };
}
