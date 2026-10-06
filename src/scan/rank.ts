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
