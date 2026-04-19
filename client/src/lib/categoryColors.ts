/**
 * Canonical colour map for exercise categories. Lifted out of
 * CategoryBreakdownTab.tsx so the analytics charts and the structured
 * exercise table can share the same palette — if a designer wants to tweak
 * the "strength" shade it now happens in one place.
 *
 * Keys align with the category values produced by `parseExercisesFromText`
 * in the server (`functional`, `running`, `strength`, `conditioning`). The
 * `other` fallback covers legacy rows and unknown-category parses.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  functional: "#f97316",
  running: "#3b82f6",
  strength: "#a855f7",
  conditioning: "#ef4444",
  other: "#64748b",
};

export function categoryColor(category: string | null | undefined): string {
  if (!category) return CATEGORY_COLORS.other;
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}
