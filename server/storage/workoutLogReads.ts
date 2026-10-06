/**
 * The athlete's workout-log list and count, as WorkoutStorage exposes them
 * (bound there as storage.workouts.listWorkoutLogs / countWorkoutLogs). Module
 * functions because they use no instance state; split out of workouts.ts when
 * PF10 gave them a training-only filter.
 */
import { type WorkoutLog, workoutLogs } from "@shared/schema";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";

import { db } from "../db";

/** Narrows listWorkoutLogs / countWorkoutLogs. */
export interface WorkoutLogFilter {
  /**
   * Only the logs that count as training (`counts_as_training`), not walks,
   * yoga or commutes. The race-prediction and overview staleness anchor reads
   * it. PF10 (CODEBASE_ANALYSIS_2026-10-03)
   */
  readonly onlyTraining?: boolean;
}

function workoutLogsOwnedBy(userId: string, filter: WorkoutLogFilter | undefined): SQL | undefined {
  const owned = eq(workoutLogs.userId, userId);
  return filter?.onlyTraining ? and(owned, eq(workoutLogs.countsAsTraining, true)) : owned;
}

export async function listWorkoutLogs(
  userId: string,
  limit?: number,
  offset?: number,
  filter?: WorkoutLogFilter,
): Promise<WorkoutLog[]> {
  let query = db
    .select()
    .from(workoutLogs)
    .where(workoutLogsOwnedBy(userId, filter))
    .orderBy(desc(workoutLogs.date))
    .$dynamic();

  if (limit !== undefined) {
    query = query.limit(limit);
  }
  if (offset !== undefined) {
    query = query.offset(offset);
  }

  return await query;
}

/**
 * How many workout logs the athlete has, total (or only those that count as
 * training, with `filter.onlyTraining`). Half of the analytics staleness
 * anchor (audit L16) — the latest DATE cannot see a second session logged on a
 * day that already had one, nor a delete of anything but the single latest
 * row, and both change the history an analysis was built on.
 */
export async function countWorkoutLogs(userId: string, filter?: WorkoutLogFilter): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(workoutLogs)
    .where(workoutLogsOwnedBy(userId, filter));
  return row?.total ?? 0;
}
