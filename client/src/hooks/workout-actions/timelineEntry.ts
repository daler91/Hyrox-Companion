import type { TimelineEntry } from "@shared/schema";

export function entryId(entry: TimelineEntry): string | null {
  return entry.workoutLogId ?? entry.planDayId ?? null;
}

// Stable identity for open-sheet surfaces while a logical session remains
// on screen. Prefer planDayId so transitions like planned -> completed
// (which may add workoutLogId after refetch) do not churn identity.
export function surfaceId(entry: TimelineEntry): string | null {
  return entry.planDayId ?? entry.workoutLogId ?? null;
}
