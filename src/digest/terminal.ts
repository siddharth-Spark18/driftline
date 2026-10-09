import { cooldownMessage } from "../scan/cooldown.ts";
import type { WorklistItem } from "../scan/types.ts";

export interface RenderOptions {
  /** Defaults to detecting a real TTY so cron/log output stays plain, uncolored text. */
  color?: boolean;
  repoLabel?: string;
  /** Items cut by the top-N cap; rendered as a "+N more" line. */
  overflow?: number;
}

const CATEGORY_ORDER: WorklistItem["category"][] = ["security", "breaking", "deprecation", "minor"];

const CATEGORY_LABELS: Record<WorklistItem["category"], string> = {
  security: "Security fixes",
  breaking: "Breaking changes",
  deprecation: "Deprecations",
  minor: "Minor / feature updates",
};

const CATEGORY_SUMMARY_NOUN: Record<WorklistItem["category"], { singular: string; plural: string }> = {
  security: { singular: "security fix", plural: "security fixes" },
  breaking: { singular: "breaking change", plural: "breaking changes" },
  deprecation: { singular: "deprecation", plural: "deprecations" },
  minor: { singular: "minor / feature update", plural: "minor / feature updates" },
};

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

/** Renders a ranked scan worklist as readable terminal output (the weekly digest, per PER-11). */
export function renderDigest(items: WorklistItem[], options: RenderOptions = {}): string {
  const color = options.color ?? Boolean(process.stdout.isTTY);
  const lines: string[] = [];

  lines.push(paint(`Driftline digest${options.repoLabel ? ` — ${options.repoLabel}` : ""}`, color, ANSI.bold));

  if (items.length === 0) {
    lines.push("");
    lines.push("Nothing to report — tracked dependencies are up to date and clear of known advisories.");
    return lines.join("\n");
  }

  lines.push(paint(summaryLine(items), color, ANSI.dim));

  let index = 1;
  for (const category of CATEGORY_ORDER) {
    const groupItems = items.filter((item) => item.category === category);
    if (groupItems.length === 0) continue;

    lines.push("");
    lines.push(paint(`${CATEGORY_LABELS[category]} (${groupItems.length})`, color, ANSI.bold, categoryColor(category)));

    for (const item of groupItems) {
      lines.push(formatItem(item, index, color));
      index += 1;
    }
  }

  if (options.overflow && options.overflow > 0) {
    lines.push("");
    lines.push(paint(`+${options.overflow} more (raise the cap with --limit or preferences.maxItems)`, color, ANSI.dim));
  }

  return lines.join("\n");
}

function summaryLine(items: WorklistItem[]): string {
  const counts: Record<WorklistItem["category"], number> = { security: 0, breaking: 0, deprecation: 0, minor: 0 };
  for (const item of items) counts[item.category] += 1;

  return CATEGORY_ORDER.filter((category) => counts[category] > 0)
    .map((category) => {
      const noun = CATEGORY_SUMMARY_NOUN[category];
      return `${counts[category]} ${counts[category] === 1 ? noun.singular : noun.plural}`;
    })
    .join(", ");
}

function formatItem(item: WorklistItem, index: number, color: boolean): string {
  const badge =
    item.category === "security" && item.severity && item.severity !== "unknown"
      ? ` [${item.severity.toUpperCase()}]`
      : "";
  const header = `${paint(`  ${index}. ${item.name}`, color, ANSI.bold)}${badge} (${item.currentVersion} -> ${item.latestVersion})`;
  const reasonLine = `     ${item.reason}`;
  const link = item.advisoryUrl ?? item.releaseUrl;

  const usageLine = item.affectedFiles
    ? `     ${item.affectedFiles.length === 0 ? "no usage detected" : `${item.affectedFiles.length} affected ${item.affectedFiles.length === 1 ? "file" : "files"}`}`
    : null;
  const cooldownLine = item.cooldown ? `     ${paint(cooldownMessage(item.cooldown.daysOld), color, ANSI.yellow)}` : null;

  return [header, reasonLine, usageLine, cooldownLine, link ? `     ${paint(link, color, ANSI.dim)}` : null]
    .filter(Boolean)
    .join("\n");
}

function categoryColor(category: WorklistItem["category"]): string {
  if (category === "security") return ANSI.red;
  if (category === "breaking" || category === "deprecation") return ANSI.yellow;
  return ANSI.cyan;
}

function paint(text: string, color: boolean, ...codes: string[]): string {
  if (!color) return text;
  return `${codes.join("")}${text}${ANSI.reset}`;
}
