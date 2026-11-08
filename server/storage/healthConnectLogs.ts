import { randomUUID } from "node:crypto";

import { type InsertWorkoutLog, recycleBinItems, type WorkoutLog, workoutLogs } from "@shared/schema";
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { captureWorkoutLogs } from "./recycleBinCapture";

// Workout-log storage for the Health Connect sync (services/healthConnectImport.ts),
// bound onto WorkoutStorage so it reads as storage.workouts.*.

/**
 * Inserts Health Connect imports; the (user_id, health_connect_id) partial
 * unique index drops a session another sync already wrote. Takes the import's
 * transaction so the logs and their synthesised sets commit together.
 */
export async function createHealthConnectWorkoutLogs(
  logs: (InsertWorkoutLog & { userId: string })[],
  executor: DbExecutor = db,
): Promise<WorkoutLog[]> {
  if (logs.length === 0) return [];
  return await executor
    .insert(workoutLogs)
    .values(logs)
    .onConflictDoNothing({
      target: [workoutLogs.userId, workoutLogs.healthConnectId],
      where: sql`${workoutLogs.healthConnectId} IS NOT NULL`,
    })
    .returning();
}

/**
 * Health Connect session ids among `ids` already imported: on a live log, or
 * on one deleted and still in the recycle bin, so a deleted import stays
 * deleted when its session is read again.
 */
export async function getExistingHealthConnectIds(userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const [live, binned] = await Promise.all([
    db
      .select({ id: workoutLogs.healthConnectId })
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), inArray(workoutLogs.healthConnectId, ids))),
    db
      .select({ id: recycleBinItems.healthConnectId })
      .from(recycleBinItems)
      .where(
        and(
          eq(recycleBinItems.userId, userId),
          inArray(recycleBinItems.healthConnectId, ids),
          gt(recycleBinItems.expiresAt, new Date()),
        ),
      ),
  ]);
  return [...new Set([...live, ...binned].flatMap((row) => (row.id ? [row.id] : [])))];
}

/**
 * Health Connect imports on `dates` the athlete has not taken over (no plan
 * day, no RPE of their own): the rows a higher-priority recording of the same
 * session may replace.
 */
export async function listUntouchedHealthConnectLogsForDates(
  userId: string,
  dates: readonly string[],
): Promise<Pick<WorkoutLog, "id" | "startedAt" | "duration" | "focus">[]> {
  if (dates.length === 0) return [];
  return await db
    .select({ id: workoutLogs.id, startedAt: workoutLogs.startedAt, duration: workoutLogs.duration, focus: workoutLogs.focus })
    .from(workoutLogs)
    .where(
      and(
        eq(workoutLogs.userId, userId),
        inArray(workoutLogs.date, [...dates]),
        isNotNull(workoutLogs.healthConnectId),
        isNull(workoutLogs.planDayId),
        isNull(workoutLogs.rpe),
      ),
    );
}

/** Ids of the untouched (no plan day, no RPE) imports of the sessions `healthConnectIds`. */
export async function findUntouchedHealthConnectLogIds(userId: string, healthConnectIds: readonly string[]): Promise<string[]> {
  if (healthConnectIds.length === 0) return [];
  const rows = await db
    .select({ id: workoutLogs.id })
    .from(workoutLogs)
    .where(
      and(
        eq(workoutLogs.userId, userId),
        inArray(workoutLogs.healthConnectId, [...healthConnectIds]),
        isNull(workoutLogs.planDayId),
        isNull(workoutLogs.rpe),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Moves workout logs to the recycle bin (restorable for its retention) and
 * deletes them: how a Health Connect import leaves when its session is
 * deleted there, or a Strava or Garmin recording of it supersedes it.
 */
export async function binWorkoutLogs(userId: string, logIds: readonly string[]): Promise<number> {
  if (logIds.length === 0) return 0;
  return await db.transaction(async (tx) => {
    await captureWorkoutLogs(tx, userId, logIds, { batchId: randomUUID() });
    const deleted = await tx
      .delete(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), inArray(workoutLogs.id, [...logIds])))
      .returning({ id: workoutLogs.id });
    return deleted.length;
  });
}
