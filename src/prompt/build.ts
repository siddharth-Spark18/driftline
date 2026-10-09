import { cooldownMessage } from "../scan/cooldown.ts";
import type { WorklistItem } from "../scan/types.ts";

export interface PromptContext {
  /** Names of the verification scripts found in the repo's own package.json (e.g. "test", "build"). */
  verifyScripts: string[];
}

// Scripts the agent is told to run, in report order. First match per group wins.
const VERIFY_SCRIPT_GROUPS: string[][] = [["test"], ["typecheck", "type-check", "check-types"], ["build"]];

/** Picks the project's own test/typecheck/build scripts out of its package.json `scripts`. */
export function findVerifyScripts(scripts: unknown): string[] {
  if (!scripts || typeof scripts !== "object") return [];
  const available = new Set(Object.keys(scripts));
  return VERIFY_SCRIPT_GROUPS.map((group) => group.find((name) => available.has(name))).filter(
    (name): name is string => Boolean(name),
  );
}

/**
 * Template-only (no LLM) prompt for the user's own coding agent. Built from
 * structured facts and links only: third-party text (release bodies, advisory
 * summaries, deprecation messages) is never embedded, so it can't smuggle
 * instructions into the agent. Minor items get no prompt.
 */
export function buildPrompt(item: WorklistItem, context: PromptContext, now: number = Date.now()): string | null {
  if (item.category === "minor") return null;

  const severity = item.severity && item.severity !== "unknown" ? `, severity: ${item.severity}` : "";
  const lines: string[] = [
    `Upgrade \`${item.name}\` from ${item.currentVersion} to ${item.latestVersion} (${item.category}${severity}).`,
    "",
    "What changed:",
    `- Version change: ${item.currentVersion} -> ${item.latestVersion}`,
    `- Category: ${item.category}`,
  ];
  if (item.category === "deprecation") {
    lines.push("- Deprecation: the latest version is flagged as deprecated on npm; see the npm page for details.");
  }
  if (item.releasedAt) {
    const ageDays = Math.max(0, Math.floor((now - Date.parse(item.releasedAt)) / (24 * 60 * 60 * 1000)));
    lines.push(`- Latest version published ${ageDays} ${ageDays === 1 ? "day" : "days"} ago.`);
  }
  if (item.cooldown) {
    lines.push(`- Note: ${cooldownMessage(item.cooldown.daysOld)}.`);
  }
  if (item.releaseUrl) lines.push(`- Release: ${item.releaseUrl}`);
  if (item.advisoryUrl) lines.push(`- Advisory: ${item.advisoryUrl}`);
  lines.push(`- npm: https://www.npmjs.com/package/${item.name}`);

  lines.push("", "Affected files:");
  if (item.affectedFiles && item.affectedFiles.length > 0) {
    for (const file of item.affectedFiles) lines.push(`- ${file.path} (${file.confidence} confidence)`);
  } else {
    lines.push("- No usage detected: confirm usage before changing anything.");
  }

  lines.push(
    "",
    "Scope: only perform this upgrade. Do not refactor unrelated code. Do not commit, push, or open a pull request.",
    "",
    "Done when:",
  );
  if (context.verifyScripts.length > 0) {
    lines.push(
      `- You have run the project's own scripts from package.json (${context.verifyScripts
        .map((name) => `\`npm run ${name}\``)
        .join(", ")}) and they pass.`,
    );
  } else {
    lines.push("- You have run whatever test, typecheck and build commands the project defines.");
  }
  lines.push("- Anything that fails is reported back, with the failing output.");

  return lines.join("\n");
}
