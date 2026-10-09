import { CATEGORY_LABELS, CATEGORY_ORDER, countByCategory, countPhrase } from "../digest/categories.ts";
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

  lines.push("## Summary", "");
  for (const category of CATEGORY_ORDER) {
    if (counts[category] > 0) lines.push(`- ${countPhrase(category, counts[category])}`);
  }
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

  return `${lines.join("\n")}\n`;
}

function renderItem(item: WorklistItem, index: number): string[] {
  const severity = item.category === "security" && item.severity && item.severity !== "unknown" ? ` [${item.severity.toUpperCase()}]` : "";
  const lines = [`### ${index}. ${item.name}${severity}`, "", `\`${item.currentVersion}\` -> \`${item.latestVersion}\``, "", item.reason];

  const details: string[] = [];
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

/** A backtick fence longer than any run of backticks inside `text`, so the prompt can't close it early. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}
