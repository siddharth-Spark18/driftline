import type { WorklistItem } from "../scan/types.ts";

export type Category = WorklistItem["category"];

/** Priority order shared by the terminal digest and the saved reports. */
export const CATEGORY_ORDER: Category[] = ["compromised", "security", "breaking", "deprecation", "minor"];

export const CATEGORY_LABELS: Record<Category, string> = {
  compromised: "Compromised packages",
  security: "Security fixes",
  breaking: "Breaking changes",
  deprecation: "Deprecations",
  minor: "Minor / feature updates",
};

export const CATEGORY_SUMMARY_NOUN: Record<Category, { singular: string; plural: string }> = {
  compromised: { singular: "compromised package", plural: "compromised packages" },
  security: { singular: "security fix", plural: "security fixes" },
  breaking: { singular: "breaking change", plural: "breaking changes" },
  deprecation: { singular: "deprecation", plural: "deprecations" },
  minor: { singular: "minor / feature update", plural: "minor / feature updates" },
};

export function countByCategory(items: WorklistItem[]): Record<Category, number> {
  const counts: Record<Category, number> = { compromised: 0, security: 0, breaking: 0, deprecation: 0, minor: 0 };
  for (const item of items) counts[item.category] += 1;
  return counts;
}

/** "2 security fixes" / "1 breaking change", with correct pluralization. */
export function countPhrase(category: Category, count: number): string {
  const noun = CATEGORY_SUMMARY_NOUN[category];
  return `${count} ${count === 1 ? noun.singular : noun.plural}`;
}

export function summaryLine(items: WorklistItem[]): string {
  const counts = countByCategory(items);
  return CATEGORY_ORDER.filter((category) => counts[category] > 0)
    .map((category) => countPhrase(category, counts[category]))
    .join(", ");
}
