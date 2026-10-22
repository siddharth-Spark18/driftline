import picocolors from "picocolors";
import { cooldownMessage } from "../scan/cooldown.ts";
import type { SkippedSummary, WorklistItem } from "../scan/types.ts";
import { LIMITS_FOOTER, safeVersionLines, skippedEmptyText, skippedHeadline, skippedReasonLines } from "./notes.ts";
import { CATEGORY_LABELS, CATEGORY_ORDER, countByCategory, countPhrase, type Category } from "./categories.ts";

export interface RenderOptions {
  /** Defaults to a real TTY with NO_COLOR unset, so cron/log output stays plain, uncolored text. */
  color?: boolean;
  repoLabel?: string;
  /** Items cut by the top-N cap; rendered as a "+N more" line. */
  overflow?: number;
  /** Packages hidden by `preferences.ignorePackages`; rendered as an "N ignored" note. */
  ignored?: number;
  /** Packages that couldn't be checked (no installed version). Rendered as a warning block; replaces the all-clear. */
  skipped?: SkippedSummary;
  /** Defaults to the terminal width (80 when unknown); clamped to a readable range. */
  width?: number;
}

const MIN_WIDTH = 40;
const MAX_WIDTH = 100;
const DEFAULT_WIDTH = 80;

interface Glyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
  dot: string;
  arrow: string;
  link: string;
  clock: string;
  logo: string;
  ellipsis: string;
  fill: Record<Category, string>;
  icon: Record<Category, string>;
}

const UNICODE_GLYPHS: Glyphs = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│",
  dot: "●",
  arrow: "→",
  link: "↗",
  clock: "◷",
  logo: "◆",
  ellipsis: "…",
  fill: { compromised: "█", security: "█", breaking: "█", deprecation: "█", minor: "█" },
  icon: { compromised: "‼", security: "✖", breaking: "▲", deprecation: "▼", minor: "●" },
};

// Used whenever color is off (NO_COLOR, pipes, logs): same layout, plain ASCII.
// Bar fills differ per category since color can't tell the segments apart.
const ASCII_GLYPHS: Glyphs = {
  tl: "+",
  tr: "+",
  bl: "+",
  br: "+",
  h: "-",
  v: "|",
  dot: "*",
  arrow: "->",
  link: "->",
  clock: "~",
  logo: "*",
  ellipsis: "...",
  fill: { compromised: "@", security: "#", breaking: "=", deprecation: "+", minor: "-" },
  icon: { compromised: "!", security: "x", breaking: "^", deprecation: "v", minor: "o" },
};

type Paint = (text: string) => string;

/** Renders a ranked scan worklist as a card-based terminal digest (banner, summary bar, one card per item). */
export function renderDigest(items: WorklistItem[], options: RenderOptions = {}): string {
  const color = options.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  const width = clampWidth(options.width ?? process.stdout.columns ?? DEFAULT_WIDTH);
  const pc = picocolors.createColors(color);
  const g = color ? UNICODE_GLYPHS : ASCII_GLYPHS;
  const lines: string[] = [];

  lines.push(...renderBanner(options.repoLabel, width, g, pc));

  const skipped = options.skipped && options.skipped.count > 0 ? options.skipped : undefined;
  if (skipped) lines.push(...renderSkipped(skipped, width, pc));

  if (items.length === 0) {
    lines.push("");
    // An all-clear is only honest when every package was actually checked.
    lines.push(
      skipped
        ? skippedEmptyText(skipped)
        : "Nothing to report — tracked dependencies are up to date and clear of known advisories.",
    );
    lines.push(...ignoredNote(options.ignored, pc));
    lines.push(...limitsFooter(width, pc));
    return lines.join("\n");
  }

  lines.push("");
  lines.push(...renderSummaryBar(items, width, g, pc));

  let index = 1;
  for (const category of CATEGORY_ORDER) {
    const groupItems = items.filter((item) => item.category === category);
    if (groupItems.length === 0) continue;

    lines.push("");
    lines.push(pc.bold(categoryPaint(category, pc)(`${g.icon[category]} ${CATEGORY_LABELS[category]} (${groupItems.length})`)));

    for (const item of groupItems) {
      lines.push(...renderCard(item, index, width, g, pc));
      index += 1;
    }
  }

  if (options.overflow && options.overflow > 0) {
    lines.push("");
    lines.push(pc.dim(`+${options.overflow} more (raise the cap with --limit or preferences.maxItems)`));
  }

  lines.push(...ignoredNote(options.ignored, pc));
  lines.push(...limitsFooter(width, pc));

  return lines.join("\n");
}

function limitsFooter(width: number, pc: Colors): string[] {
  return ["", ...wrap(LIMITS_FOOTER, width).map((line) => pc.dim(line))];
}

function renderSkipped(skipped: SkippedSummary, width: number, pc: Colors): string[] {
  const rows = [skippedHeadline(skipped), ...skippedReasonLines(skipped).map((line) => `- ${line}`)];
  // The headline gets a "! " prefix, so it wraps two columns narrower to stay within the digest width.
  return [
    "",
    ...rows.flatMap((row, i) =>
      i === 0
        ? wrap(row, width - 2).map((line) => pc.bold(pc.yellow(`! ${line}`)))
        : wrap(row, width).map((line) => pc.yellow(line)),
    ),
  ];
}

function ignoredNote(ignored: number | undefined, pc: Colors): string[] {
  return ignored && ignored > 0 ? ["", pc.dim(`${ignored} ignored (preferences.ignorePackages)`)] : [];
}

function renderBanner(repoLabel: string | undefined, width: number, g: Glyphs, pc: Colors): string[] {
  const inner = width - 4;
  const title = `${g.logo} Driftline digest`;
  const v = pc.cyan(g.v);
  const rows = [`${v} ${pc.bold(pc.cyan(pad(title, inner)))} ${v}`];
  if (repoLabel) {
    rows.push(`${v} ${pc.dim(pad(truncateStart(repoLabel, inner, g.ellipsis), inner))} ${v}`);
  }
  return [pc.cyan(g.tl + g.h.repeat(width - 2) + g.tr), ...rows, pc.cyan(g.bl + g.h.repeat(width - 2) + g.br)];
}

function renderSummaryBar(items: WorklistItem[], width: number, g: Glyphs, pc: Colors): string[] {
  const counts = countByCategory(items);
  const present = CATEGORY_ORDER.filter((category) => counts[category] > 0);

  // Proportional segments, at least one cell each so small categories stay visible.
  const sizes = present.map((category) => Math.max(1, Math.floor((counts[category] / items.length) * width)));
  const largest = sizes.indexOf(Math.max(...sizes));
  sizes[largest] += width - sizes.reduce((sum, size) => sum + size, 0);

  const bar = present.map((category, i) => categoryPaint(category, pc)(g.fill[category].repeat(sizes[i]))).join("");

  const legend = present.map((category) => ({
    plain: `${g.dot} ${countPhrase(category, counts[category])}`,
    styled: categoryPaint(category, pc)(g.dot) + ` ${countPhrase(category, counts[category])}`,
  }));
  return [bar, ...packLegend(legend, width)];
}

/** Lays legend entries out left to right, starting a new line when the next one wouldn't fit. */
function packLegend(entries: { plain: string; styled: string }[], width: number): string[] {
  const lines: string[] = [];
  let currentPlain = "";
  let currentStyled = "";
  for (const entry of entries) {
    if (currentPlain && currentPlain.length + 2 + entry.plain.length > width) {
      lines.push(currentStyled);
      currentPlain = "";
      currentStyled = "";
    }
    currentPlain += (currentPlain ? "  " : "") + entry.plain;
    currentStyled += (currentStyled ? "  " : "") + entry.styled;
  }
  if (currentStyled) lines.push(currentStyled);
  return lines;
}

function renderCard(item: WorklistItem, index: number, width: number, g: Glyphs, pc: Colors): string[] {
  const inner = width - 4;
  const border = categoryPaint(item.category, pc);
  const v = border(g.v);
  const body = (text: string, style: Paint = (s) => s): string[] =>
    wrap(text, inner).map((chunk) => `${v} ${style(pad(chunk, inner))} ${v}`);

  const rows: string[] = [];

  // Header: "<n>. <name>" on the left, category/severity badges on the right.
  const title = `${index}. ${item.name}`;
  const badges = [{ plain: badgeText(item.category), styled: categoryBadge(item.category, pc) }];
  if (item.category === "security" && item.severity && item.severity !== "unknown") {
    badges.push({ plain: `[${item.severity.toUpperCase()}]`, styled: severityPaint(item.severity, pc)(`[${item.severity.toUpperCase()}]`) });
  }
  const badgesPlain = badges.map((b) => b.plain).join(" ");
  const badgesStyled = badges.map((b) => b.styled).join(" ");
  const icon = g.icon[item.category];
  const left = `${icon} ${title}`;
  if (left.length + 1 + badgesPlain.length <= inner) {
    const gap = " ".repeat(inner - left.length - badgesPlain.length);
    rows.push(`${v} ${border(icon)} ${pc.bold(title)}${gap}${badgesStyled} ${v}`);
  } else {
    rows.push(...body(left, (s) => pc.bold(s)));
    rows.push(`${v} ${badgesStyled}${" ".repeat(Math.max(0, inner - badgesPlain.length))} ${v}`);
  }

  if (item.category === "compromised") {
    rows.push(...body(`${item.currentVersion} is listed as malicious`, (s) => pc.bold(pc.red(s))));
    if (item.ignored) rows.push(...body("on your ignore list (shown because of this advisory)", pc.dim));
    rows.push(...body(item.reason));
    for (const line of safeVersionLines(item.safeVersions)) rows.push(...body(line, pc.dim));
    if (item.otherAdvisoryCount) {
      rows.push(...body(`+${item.otherAdvisoryCount} other ${item.otherAdvisoryCount === 1 ? "advisory" : "advisories"} also affect this version`, pc.dim));
    }
    rows.push(...body("Reinstall with npm ci, check install scripts, rotate credentials on affected machines and CI.", pc.yellow));
  } else {
    // Ignored packages aren't checked against the registry, so there is no "latest" to show.
    rows.push(...body(item.ignored ? item.currentVersion : `${item.currentVersion} ${g.arrow} ${item.latestVersion}`, pc.bold));
    if (item.ignored) rows.push(...body("on your ignore list (shown because of this advisory)", pc.dim));
    rows.push(...body(item.reason));
    if (item.category === "security") {
      const fix = fixLine(item);
      if (fix) rows.push(...body(fix, pc.green));
    }
  }

  if (item.affectedFiles) {
    const count = item.affectedFiles.length;
    rows.push(...body(count === 0 ? "no usage detected" : `${count} affected ${count === 1 ? "file" : "files"}`, pc.dim));
  }
  if (item.cooldown) rows.push(...body(`${g.clock} ${cooldownMessage(item.cooldown.daysOld)}`, pc.yellow));

  const link = item.advisoryUrl ?? item.releaseUrl;
  // A URL too long for the card is wrapped on its own, without the icon stranded on a line by itself.
  if (link) rows.push(...body(`${g.link} ${link}`.length <= inner ? `${g.link} ${link}` : link, pc.dim));

  return [border(g.tl + g.h.repeat(width - 2) + g.tr), ...rows, border(g.bl + g.h.repeat(width - 2) + g.br)];
}

/** "Fix: 1.0.1" beside `latest`, or why there is none. */
function fixLine(item: WorklistItem): string | undefined {
  if (item.fixedVersion) {
    return `Fix: ${item.fixedVersion}${item.fixNeedsMajorUpgrade ? " (needs a major upgrade)" : ""}`;
  }
  return item.noFixPublished ? "no fixed version published" : undefined;
}

type Colors = ReturnType<typeof picocolors.createColors>;

function badgeText(category: Category): string {
  return `[${category.toUpperCase()}]`;
}

function categoryBadge(category: Category, pc: Colors): string {
  const text = badgeText(category);
  // Same visible width either way (brackets vs. padding), so layout math ignores color.
  if (!pc.isColorSupported) return text;
  const bg = { compromised: (s: string) => pc.bgRed(pc.white(s)), security: pc.bgRed, breaking: pc.bgMagenta, deprecation: pc.bgYellow, minor: pc.bgCyan }[category];
  return pc.bold(bg(pc.black(` ${category.toUpperCase()} `)));
}

function categoryPaint(category: Category, pc: Colors): Paint {
  return { compromised: (s: string) => pc.bold(pc.red(s)), security: pc.red, breaking: pc.magenta, deprecation: pc.yellow, minor: pc.cyan }[category];
}

function severityPaint(severity: NonNullable<WorklistItem["severity"]>, pc: Colors): Paint {
  if (severity === "critical" || severity === "high") return (s) => pc.bold(pc.red(s));
  if (severity === "moderate") return pc.yellow;
  return pc.cyan;
}

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(width)));
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

function truncateStart(text: string, width: number, ellipsis: string): string {
  if (text.length <= width) return text;
  return ellipsis + text.slice(text.length - (width - ellipsis.length));
}

/** Word-wraps to `width`, hard-breaking tokens (e.g. long URLs) that can't fit on a line. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (current && current.length + 1 + rest.length > width) {
      lines.push(current);
      current = rest;
    } else {
      current = current ? `${current} ${rest}` : rest;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}
