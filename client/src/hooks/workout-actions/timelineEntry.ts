import type { TimelineEntry } from "@shared/schema";

export function entryId(entry: TimelineEntry): string | null {
  return entry.workoutLogId ?? entry.planDayId ?? null;
}
