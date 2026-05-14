import type { TimelineEntry } from "@shared/schema";

export interface BulkDeleteWorkoutTargets {
  workoutLogIds: string[];
  planDayIds: string[];
}

export function isTimelineEntryBulkDeletable(entry: TimelineEntry): boolean {
  return Boolean(entry.planDayId || entry.workoutLogId);
}

export function buildBulkDeleteWorkoutTargets(entries: readonly TimelineEntry[]): BulkDeleteWorkoutTargets {
  const workoutLogIds = new Set<string>();
  const planDayIds = new Set<string>();

  for (const entry of entries) {
    if (entry.planDayId) {
      planDayIds.add(entry.planDayId);
    } else if (entry.workoutLogId) {
      workoutLogIds.add(entry.workoutLogId);
    }
  }

  return {
    workoutLogIds: Array.from(workoutLogIds),
    planDayIds: Array.from(planDayIds),
  };
}

export function getBulkDeleteSelectionKey(entry: TimelineEntry): string | null {
  if (entry.planDayId) return `plan:${entry.planDayId}`;
  if (entry.workoutLogId) return `log:${entry.workoutLogId}`;
  return null;
}
