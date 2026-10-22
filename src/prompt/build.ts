import { safeVersionLines } from "../digest/notes.ts";
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
  if (item.category === "compromised") return buildCompromisedPrompt(item, now);

  const severity = item.severity && item.severity !== "unknown" ? `, severity: ${item.severity}` : "";
  // A security item targets the smallest fix when one is known; `latest` is still mentioned below.
  const target = item.category === "security" && item.fixedVersion ? item.fixedVersion : item.latestVersion;
  const lines: string[] = [
    `Upgrade \`${item.name}\` from ${item.currentVersion} to ${target} (${item.category}${severity}).`,
    "",
    "What changed:",
    `- Version change: ${item.currentVersion} -> ${target}`,
    `- Category: ${item.category}`,
  ];
  if (item.category === "security") {
    if (item.fixedVersion) {
      lines.push(
        `- Fixed version: ${item.fixedVersion}, the lowest release that fixes the advisories affecting ${item.currentVersion}${
          item.fixNeedsMajorUpgrade ? " (needs a major upgrade: it is outside the installed release line)" : " (same release line)"
        }.`,
      );
    } else if (item.noFixPublished) {
      lines.push("- No fixed version is published for this advisory: read the advisory before choosing a version.");
    }
    if (item.latestVersion !== target) lines.push(`- Latest on npm: ${item.latestVersion}`);
  }
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

/**
 * Separate template for a known-malicious installed version. Never auto-pins:
 * the agent investigates and reports, and the user decides the version. Like
 * the other templates it embeds only links and our own text.
 */
function buildCompromisedPrompt(item: WorklistItem, now: number): string {
  const lines: string[] = [
    `Investigate and remediate \`${item.name}\` ${item.currentVersion}: this installed version is listed as malicious (compromised package).`,
    "",
    "What we know:",
    `- Installed version: ${item.currentVersion}`,
  ];
  if (item.advisoryUrl) lines.push(`- Advisory: ${item.advisoryUrl}`);
  lines.push(`- npm: https://www.npmjs.com/package/${item.name}`);
  for (const line of safeVersionLines(item.safeVersions, now)) lines.push(`- ${line}`);
  lines.push(
    "- These versions are information, not a recommendation or a guarantee: a version that is not listed as bad may still be bad, because advisory data can lag.",
  );

  lines.push("", "Affected files:");
  if (item.affectedFiles && item.affectedFiles.length > 0) {
    for (const file of item.affectedFiles) lines.push(`- ${file.path} (${file.confidence} confidence)`);
  } else {
    lines.push("- No usage detected: confirm usage before changing anything.");
  }

  lines.push(
    "",
    "Steps:",
    "1. Do NOT change the pinned version, the version range in package.json, or package-lock.json yourself. Present the versions above and ask the user which one to use before editing anything.",
    `2. Check the install scripts of \`${item.name}\` (preinstall, install, postinstall in its package.json) and tell the user what they run. Do not run the project's own scripts or tests until the user confirms the pin.`,
    "3. Once the user has settled the pin, reinstall exactly from the lockfile with `npm ci` (not `npm install`), so nothing resolves to a different version.",
    "4. Tell the user to rotate credentials (npm, cloud, CI and other tokens, SSH keys, environment secrets) that were present on any machine or CI job that installed this version. List where to look; do not rotate or read secrets yourself.",
    "",
    "Scope: investigate and report only. Do not refactor unrelated code. Do not commit, push, or open a pull request.",
    "",
    "Done when:",
    "- You have reported the install scripts you found, the versions to choose from, and the credential-rotation reminder.",
    "- The user has chosen a pin, or has told you to leave it as it is.",
  );
  return lines.join("\n");
}
