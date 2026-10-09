import type { Severity, WorklistItem } from "./types.ts";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  unknown: 4,
};

const CATEGORY_ORDER: Record<WorklistItem["category"], number> = {
  security: 0,
  breaking: 1,
  deprecation: 2,
  minor: 3,
};

/**
 * Orders a worklist per the brief's rule-based priority: security fix (by
 * severity) > breaking change > deprecation > minor/feature, then by name.
 * Deterministic — no Claude API involved.
 */
export function rankWorklist(items: WorklistItem[]): WorklistItem[] {
  return [...items].sort((a, b) => {
    const categoryDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (categoryDiff !== 0) return categoryDiff;

    if (a.category === "security") {
      const severityDiff = SEVERITY_ORDER[a.severity ?? "unknown"] - SEVERITY_ORDER[b.severity ?? "unknown"];
      if (severityDiff !== 0) return severityDiff;
    }

    return a.name.localeCompare(b.name);
  });
}

export interface CappedWorklist {
  items: WorklistItem[];
  /** How many ranked items were cut by the cap. */
  overflow: number;
}

/**
 * Applies the top-N cap to an already-ranked worklist. Security items are never
 * dropped, so the result can exceed `maxItems` when there are more than that
 * many security items.
 */
export function capWorklist(ranked: WorklistItem[], maxItems: number): CappedWorklist {
  const securityCount = ranked.filter((item) => item.category === "security").length;
  const keep = Math.max(maxItems, securityCount);
  return { items: ranked.slice(0, keep), overflow: Math.max(0, ranked.length - keep) };
}
