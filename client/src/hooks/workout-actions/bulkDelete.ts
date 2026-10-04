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
    // The same rule as the single delete (useWorkoutActions.handleDelete): a
    // completed planned session's log is the workout, and deleting it lets
    // the server re-sync its plan day to planned or missed. Sending the plan
    // day instead left the log behind as an unplanned workout. Only an entry
    // with no log deletes its plan day. CL23 (CODEBASE_ANALYSIS_2026-10-03)
    if (entry.workoutLogId) {
      workoutLogIds.add(entry.workoutLogId);
    } else if (entry.planDayId) {
      planDayIds.add(entry.planDayId);
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
