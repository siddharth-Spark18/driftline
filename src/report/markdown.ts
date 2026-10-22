import { CATEGORY_LABELS, CATEGORY_ORDER, countByCategory, countPhrase } from "../digest/categories.ts";
import { LIMITS_NOTES, safeVersionLines, skippedEmptyText, skippedHeadline, skippedReasonLines } from "../digest/notes.ts";
import { cooldownMessage } from "../scan/cooldown.ts";
import type { WorklistItem } from "../scan/types.ts";
import type { ReportData } from "./types.ts";

/** Markdown report: summary plus one section per category, agent prompts in fenced blocks. */
export function buildMarkdownReport(data: ReportData): string {
  const counts = countByCategory(data.worklist);
  const lines: string[] = [];

  lines.push("# Driftline report", "");
  lines.push(`- Repo: \`${data.repo}\``);
  lines.push(`- Scanned: ${data.scannedAt}`);
  lines.push(`- Driftline: v${data.driftlineVersion}`, "");

  const skipped = data.skipped && data.skipped.count > 0 ? data.skipped : undefined;
  if (skipped) {
    lines.push("## Warning: packages not checked", "", skippedHeadline(skipped), "");
    for (const line of skippedReasonLines(skipped)) lines.push(`- ${line}`);
    lines.push("");
  }

  lines.push("## Summary", "");
  for (const category of CATEGORY_ORDER) {
    if (counts[category] > 0) lines.push(`- ${countPhrase(category, counts[category])}`);
  }
  if (data.worklist.length === 0 && skipped) lines.push(`- ${skippedEmptyText(skipped)}`);
  if (data.overflow > 0) lines.push(`- +${data.overflow} more not shown (raise the cap with --limit or preferences.maxItems)`);

  let index = 1;
  for (const category of CATEGORY_ORDER) {
    const groupItems = data.worklist.filter((item) => item.category === category);
    if (groupItems.length === 0) continue;

    lines.push("", `## ${CATEGORY_LABELS[category]} (${groupItems.length})`);
    for (const item of groupItems) {
      lines.push("", ...renderItem(item, index));
      index += 1;
    }
  }

  lines.push("", "## Notes", "");
  for (const note of LIMITS_NOTES) lines.push(`- ${note}`);

  return `${lines.join("\n")}\n`;
}

function renderItem(item: WorklistItem, index: number): string[] {
  if (item.category === "compromised") return renderCompromised(item, index);
  const severity = item.category === "security" && item.severity && item.severity !== "unknown" ? ` [${item.severity.toUpperCase()}]` : "";
  const lines = [`### ${index}. ${item.name}${severity}`, "", item.ignored ? `\`${item.currentVersion}\` (on your ignore list; shown because of this advisory)` : `\`${item.currentVersion}\` -> \`${item.latestVersion}\``, "", item.reason];

  const details: string[] = [];
  if (item.category === "security") {
    if (item.fixedVersion) {
      details.push(`- Fix: \`${item.fixedVersion}\`${item.fixNeedsMajorUpgrade ? " (needs a major upgrade)" : ""}`);
    } else if (item.noFixPublished) {
      details.push("- Fix: no fixed version published");
    }
  }
  if (item.affectedFiles) {
    if (item.affectedFiles.length === 0) {
      details.push("- Affected files: none detected");
    } else {
      details.push("- Affected files:");
      for (const file of item.affectedFiles) details.push(`  - \`${file.path}\` (${file.confidence} confidence)`);
    }
  }
  if (item.cooldown) details.push(`- Cooldown: ${cooldownMessage(item.cooldown.daysOld)}`);
  if (item.advisoryUrl) details.push(`- Advisory: ${item.advisoryUrl}`);
  if (item.releaseUrl) details.push(`- Release notes: ${item.releaseUrl}`);
  if (details.length > 0) lines.push("", ...details);

  if (item.prompt) {
    const fence = fenceFor(item.prompt);
    lines.push("", "Agent prompt:", "", `${fence}text`, item.prompt, fence);
  }
  return lines;
}

function renderCompromised(item: WorklistItem, index: number): string[] {
  const lines = [
    `### ${index}. ${item.name} [COMPROMISED]`,
    "",
    `**\`${item.currentVersion}\` is listed as malicious.**${item.ignored ? " (On your ignore list; shown because of this advisory.)" : ""}`,
    "",
    item.reason,
    "",
    ...safeVersionLines(item.safeVersions).map((line) => `- ${line}`),
    "- These versions are information, not a guarantee: not being listed as bad does not prove a release is clean.",
  ];
  if (item.otherAdvisoryCount) lines.push(`- ${item.otherAdvisoryCount} other ${item.otherAdvisoryCount === 1 ? "advisory also affects" : "advisories also affect"} this version`);
  if (item.advisoryUrl) lines.push(`- Advisory: ${item.advisoryUrl}`);
  if (item.affectedFiles) {
    if (item.affectedFiles.length === 0) {
      lines.push("- Affected files: none detected");
    } else {
      lines.push("- Affected files:");
      for (const file of item.affectedFiles) lines.push(`  - \`${file.path}\` (${file.confidence} confidence)`);
    }
  }
  if (item.prompt) {
    const fence = fenceFor(item.prompt);
    lines.push("", "Agent prompt:", "", `${fence}text`, item.prompt, fence);
  }
  return lines;
}

/** A backtick fence longer than any run of backticks inside `text`, so the prompt can't close it early. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}
