import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, join, relative, sep } from "node:path";
import type { AffectedFile, UsageConfidence } from "./types.ts";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

// Build output and tooling caches: never a source of truth for what the repo uses.
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".git",
  ".driftline",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".output",
  ".svelte-kit",
]);

const MAX_FILE_BYTES = 512 * 1024;

// Files where tooling packages get referenced by name without being imported.
const CONFIG_FILE_PATTERN =
  /^(\..+rc(\.(json|js|cjs|mjs|ya?ml))?|.+\.config\.(js|cjs|mjs|ts|json)|tsconfig(\..+)?\.json|.+\.ya?ml)$/;

// `from "x"`, side-effect `import "x"`, dynamic `import("x")`, and `require("x")`.
const MODULE_REFERENCE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g;

const CONFIDENCE_RANK: Record<UsageConfidence, number> = { high: 0, medium: 1, low: 2 };

const NODE_BUILTINS = new Set(builtinModules);

type FoundFiles = Map<string, UsageConfidence>;

/**
 * Finds the files that reference each package: one pass over the repo's files
 * (workspace members included, since the walk covers the whole tree), no pass
 * per package. Everything runs locally; file contents never leave the machine.
 *
 * Confidence: "high" for an import/require in code, "low" when that match sits
 * on a comment line, "medium" for indirect references (package.json scripts,
 * tool config files, `@types/*` packages whose runtime twin is imported).
 */
export function detectUsage(repoPath: string, packageNames: string[]): Map<string, AffectedFile[]> {
  const wanted = new Set(packageNames);
  const found = new Map<string, FoundFiles>(packageNames.map((name) => [name, new Map()]));
  const binToPackage = collectBinNames(repoPath, packageNames);
  const ignore = readGitignore(repoPath);

  for (const absPath of walk(repoPath, ignore)) {
    const fileName = basename(absPath);
    const relPath = relative(repoPath, absPath).split(sep).join("/");

    let text: string;
    try {
      if (statSync(absPath).size > MAX_FILE_BYTES) continue;
      text = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const ext = fileName.slice(fileName.lastIndexOf("."));
    if (SOURCE_EXTENSIONS.has(ext)) {
      scanSource(text, relPath, wanted, found);
    }
    if (fileName === "package.json") {
      scanScripts(text, relPath, binToPackage, found);
    }
    if (CONFIG_FILE_PATTERN.test(fileName)) {
      scanConfig(text, relPath, fileName, wanted, found);
    }
  }

  const result = new Map<string, AffectedFile[]>();
  for (const [name, files] of found) {
    result.set(
      name,
      [...files.entries()]
        .map(([path, confidence]) => ({ path, confidence }))
        .sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] || a.path.localeCompare(b.path)),
    );
  }
  return result;
}

function record(found: Map<string, FoundFiles>, name: string, path: string, confidence: UsageConfidence): void {
  const files = found.get(name);
  if (!files) return;
  const existing = files.get(path);
  if (!existing || CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[existing]) files.set(path, confidence);
}

function scanSource(text: string, relPath: string, wanted: Set<string>, found: Map<string, FoundFiles>): void {
  for (const match of text.matchAll(MODULE_REFERENCE)) {
    const specifier = match[2];
    const name = packageNameFromSpecifier(specifier);
    if (!name) continue;

    const confidence: UsageConfidence = isCommentLine(text, match.index ?? 0) ? "low" : "high";
    if (wanted.has(name)) record(found, name, relPath, confidence);

    // `@types/foo` is never imported itself; it is used wherever `foo` is.
    const typesName = `@types/${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`;
    if (wanted.has(typesName)) record(found, typesName, relPath, "medium");
    if (wanted.has("@types/node") && isNodeBuiltin(specifier)) record(found, "@types/node", relPath, "medium");
  }
}

function scanScripts(
  text: string,
  relPath: string,
  binToPackage: Map<string, string[]>,
  found: Map<string, FoundFiles>,
): void {
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
  } catch {
    return;
  }
  if (!scripts || typeof scripts !== "object") return;

  const commands = Object.values(scripts as Record<string, unknown>).filter((v): v is string => typeof v === "string");
  for (const [token, names] of binToPackage) {
    const pattern = new RegExp(`(^|[\\s;&|"'=/(])${escapeRegExp(token)}($|[\\s;&|"')])`);
    if (commands.some((command) => pattern.test(command))) {
      for (const name of names) record(found, name, relPath, "medium");
    }
  }
}

function scanConfig(
  text: string,
  relPath: string,
  fileName: string,
  wanted: Set<string>,
  found: Map<string, FoundFiles>,
): void {
  for (const name of wanted) {
    const quoted = new RegExp(`["']${escapeRegExp(name)}(["'/])`);
    if (quoted.test(text)) {
      record(found, name, relPath, "medium");
      continue;
    }
    // tsconfig `"types": ["node"]` refers to `@types/node`.
    if (name.startsWith("@types/") && fileName.startsWith("tsconfig")) {
      if (new RegExp(`["']${escapeRegExp(name.slice("@types/".length))}["']`).test(text)) {
        record(found, name, relPath, "medium");
      }
    }
  }
}

/** Maps every token a package can appear as in a script (its name, plus its bin names) to the package. */
function collectBinNames(repoPath: string, packageNames: string[]): Map<string, string[]> {
  const tokens = new Map<string, string[]>();
  const add = (token: string, name: string) => tokens.set(token, [...(tokens.get(token) ?? []), name]);

  for (const name of packageNames) {
    add(name, name);
    const manifestPath = join(repoPath, "node_modules", name, "package.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const bin = (JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: unknown }).bin;
      if (typeof bin === "string") add(name.split("/").pop() as string, name);
      else if (bin && typeof bin === "object") for (const key of Object.keys(bin)) add(key, name);
    } catch {
      // unreadable manifest: fall back to name-only matching
    }
  }
  return tokens;
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0];
}

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return NODE_BUILTINS.has(specifier.split("/")[0]);
}

function isCommentLine(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const prefix = text.slice(lineStart, index).trimStart();
  return prefix.startsWith("//") || prefix.startsWith("*") || prefix.startsWith("/*");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface IgnoreRules {
  names: Set<string>;
  suffixes: string[];
}

/**
 * Best-effort root .gitignore support: plain names/paths (`generated`, `/tmp/`)
 * and `*.ext` patterns. Anything fancier (negation, nested globs) is ignored
 * rather than half-implemented.
 */
function readGitignore(repoPath: string): IgnoreRules {
  const rules: IgnoreRules = { names: new Set(), suffixes: [] };
  const path = join(repoPath, ".gitignore");
  if (!existsSync(path)) return rules;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return rules;
  }
  for (const line of raw.split("\n").map((l) => l.trim())) {
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const pattern = line.replace(/^\//, "").replace(/\/$/, "");
    if (pattern.startsWith("*.") && !/[*?[/]/.test(pattern.slice(1))) rules.suffixes.push(pattern.slice(1));
    else if (!/[*?[/]/.test(pattern)) rules.names.add(pattern);
  }
  return rules;
}

function* walk(dir: string, ignore: IgnoreRules): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ignore.names.has(entry.name) || ignore.suffixes.some((suffix) => entry.name.endsWith(suffix))) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(full, ignore);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
