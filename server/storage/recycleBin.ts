import {
  exerciseSets,
  mafWorkoutAnalysis,
  planDays,
  type RecycleBinBatchRestoreResult,
  type RecycleBinEntityType,
  recycleBinEntityTypeEnum,
  type RecycleBinItem,
  recycleBinItems,
  type RecycleBinListItem,
  type RecycleBinListResponse,
  type RecycleBinPayload,
  type RecycleBinPlanDaySnapshot,
  type RecycleBinRestoreFailureReason,
  type RecycleBinRestoreResult,
  type RecycleBinStructureBlockSnapshot,
  trainingPlans,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { and, desc, eq, getTableColumns, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { db, type DbExecutor } from "../db";
import { isUniqueViolation } from "../dbErrors";
import { syncPlanDayStatusesFromWorkouts, syncPlanDayStatusFromWorkouts } from "./planDayStatus";

/**
 * The recycle bin: list, restore and purge the snapshots that
 * recycleBinCapture.ts writes at delete time.
 *
 * Restore runs in one transaction and re-inserts the captured graph with its
 * ORIGINAL ids, so a MAF analysis, a client cache or a URL that still names
 * the record resolves again. It then re-attaches what the delete detached
 * (plan-day links on workout logs, analysis rows) and re-derives plan-day
 * status from the workout count, the same rule every other write path uses.
 */

const LIST_CAP = 500;
const INSERT_CHUNK_SIZE = 200;

type RowRecord = Record<string, unknown>;

/**
 * jsonb round-trips a `Date` as an ISO string, and Drizzle's timestamp mapper
 * calls `.toISOString()` on whatever it is handed — so a captured row cannot
 * be inserted as-is. Revive every timestamp column the table declares; any
 * column the payload carries that the table no longer has is dropped by
 * Drizzle, and a column added since capture takes its default.
 */
export function reviveRow<T extends PgTable>(table: T, row: RowRecord): T["$inferInsert"] {
  const out: RowRecord = { ...row };
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const value = out[key];
    if (column.columnType === "PgTimestamp" && typeof value === "string") {
      out[key] = new Date(value);
    }
  }
  return out;
}

/** The failure half of both restore result unions — structurally identical, so one builder serves both. */
type RestoreFailure = Extract<RecycleBinRestoreResult, { ok: false }>;

function fail(reason: RecycleBinRestoreFailureReason, message: string): RestoreFailure {
  return { ok: false, reason, message };
}

const NOT_FOUND_MESSAGE = "Recycle bin item not found";
const ID_CONFLICT_MESSAGE =
  "A record with the same id already exists, so this item cannot be restored";

/** Thrown inside a transaction to roll it back while carrying the user-facing failure out. */
class RestoreAbort extends Error {
  constructor(readonly result: RestoreFailure) {
    super(result.message);
    this.name = "RestoreAbort";
  }
}

async function insertChunked<T extends PgTable>(
  tx: DbExecutor,
  table: T,
  rows: T["$inferInsert"][],
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    await tx.insert(table).values(rows.slice(start, start + INSERT_CHUNK_SIZE));
  }
}

async function ownsPlan(tx: DbExecutor, userId: string, planId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: trainingPlans.id })
    .from(trainingPlans)
    .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
    .limit(1);
  return Boolean(row);
}

async function ownsPlanDay(tx: DbExecutor, userId: string, dayId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: planDays.id })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .where(and(eq(planDays.id, dayId), eq(trainingPlans.userId, userId)))
    .limit(1);
  return Boolean(row);
}

async function ownsWorkoutLog(tx: DbExecutor, userId: string, logId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: workoutLogs.id })
    .from(workoutLogs)
    .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)))
    .limit(1);
  return Boolean(row);
}

async function hasLiveDeviceActivity(
  tx: DbExecutor,
  userId: string,
  column: typeof workoutLogs.stravaActivityId | typeof workoutLogs.garminActivityId,
  activityId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: workoutLogs.id })
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, userId), eq(column, activityId)))
    .limit(1);
  return Boolean(row);
}

/** Sets, then blocks, then their steps — the FK order. */
async function insertChildren(
  tx: DbExecutor,
  sets: RowRecord[],
  blocks: RecycleBinStructureBlockSnapshot[],
): Promise<void> {
  await insertChunked(
    tx,
    exerciseSets,
    sets.map((set) => reviveRow(exerciseSets, set)),
  );
  await insertChunked(
    tx,
    workoutStructureBlocks,
    blocks.map(({ block }) => reviveRow(workoutStructureBlocks, block)),
  );
  await insertChunked(
    tx,
    workoutStructureSteps,
    blocks.flatMap(({ steps }) => steps.map((step) => reviveRow(workoutStructureSteps, step))),
  );
}

type WorkoutLogInsert = typeof workoutLogs.$inferInsert;

/**
 * Backstop only: while the item is binned the sync's dedupe already treats
 * the activity as imported, so this can only trip on a genuine race.
 */
async function findReimportedDeviceActivity(
  tx: DbExecutor,
  userId: string,
  row: WorkoutLogInsert,
): Promise<RestoreFailure | null> {
  const providers = [
    { name: "Strava", column: workoutLogs.stravaActivityId, activityId: row.stravaActivityId },
    { name: "Garmin", column: workoutLogs.garminActivityId, activityId: row.garminActivityId },
  ] as const;
  for (const { name, column, activityId } of providers) {
    if (activityId && (await hasLiveDeviceActivity(tx, userId, column, activityId))) {
      return fail(
        "device_activity_reimported",
        `This ${name} activity has been imported again since the workout was deleted. Delete the newer copy to restore this one.`,
      );
    }
  }
  return null;
}

/**
 * Every FK the delete SET NULL'd on OTHER rows is re-linked by the caller; the
 * FKs on THIS row point at records that may themselves have gone since, so
 * drop the ones that no longer resolve. Returns the athlete-facing warnings.
 */
async function detachMissingLogReferences(
  tx: DbExecutor,
  userId: string,
  row: WorkoutLogInsert,
): Promise<string[]> {
  const warnings: string[] = [];
  if (row.planDayId && !(await ownsPlanDay(tx, userId, row.planDayId))) {
    row.planDayId = null;
    warnings.push(
      "The plan day this workout belonged to no longer exists, so it was restored as an unplanned workout.",
    );
  }
  if (row.planId && !(await ownsPlan(tx, userId, row.planId))) {
    row.planId = null;
  }
  if (row.suggestedPlanDayId && !(await ownsPlanDay(tx, userId, row.suggestedPlanDayId))) {
    row.suggestedPlanDayId = null;
  }
  if (row.suggestedWorkoutLogId && !(await ownsWorkoutLog(tx, userId, row.suggestedWorkoutLogId))) {
    row.suggestedWorkoutLogId = null;
  }
  if (!row.suggestedPlanDayId && !row.suggestedWorkoutLogId) {
    row.suggestedLinkConfidence = null;
  }
  return warnings;
}

async function restoreWorkoutLog(
  tx: DbExecutor,
  userId: string,
  payload: Extract<RecycleBinPayload, { kind: "workout_log" }>,
): Promise<{ ok: true; warnings: string[] } | RestoreFailure> {
  const { log, exerciseSets: sets, structureBlocks, mafWorkoutAnalysisIds } = payload.workout;
  const row = reviveRow(workoutLogs, log);

  const reimported = await findReimportedDeviceActivity(tx, userId, row);
  if (reimported) return reimported;

  const warnings = await detachMissingLogReferences(tx, userId, row);

  await tx.insert(workoutLogs).values({ ...row, userId });
  await insertChildren(tx, sets, structureBlocks);

  if (mafWorkoutAnalysisIds.length) {
    await tx
      .update(mafWorkoutAnalysis)
      .set({ workoutLogId: row.id })
      .where(
        and(
          inArray(mafWorkoutAnalysis.id, mafWorkoutAnalysisIds),
          eq(mafWorkoutAnalysis.userId, userId),
          isNull(mafWorkoutAnalysis.workoutLogId),
        ),
      );
  }
  if (row.planDayId) {
    await syncPlanDayStatusFromWorkouts(row.planDayId, userId, tx);
  }
  return { ok: true, warnings };
}

/** Re-point the logs a plan-day delete unlinked, but only ones still unlinked — the athlete may have re-planned them since. */
async function relinkLogsToDay(
  tx: DbExecutor,
  userId: string,
  day: { id: string; planId: string },
  logIds: readonly string[],
): Promise<void> {
  if (logIds.length === 0) return;
  await tx
    .update(workoutLogs)
    .set({ planDayId: day.id, planId: day.planId })
    .where(
      and(
        inArray(workoutLogs.id, [...logIds]),
        eq(workoutLogs.userId, userId),
        isNull(workoutLogs.planDayId),
      ),
    );
}

async function insertPlanDaySnapshots(
  tx: DbExecutor,
  snapshots: readonly RecycleBinPlanDaySnapshot[],
): Promise<void> {
  await insertChunked(
    tx,
    planDays,
    snapshots.map((snapshot) => reviveRow(planDays, snapshot.day)),
  );
  await insertChildren(
    tx,
    snapshots.flatMap((snapshot) => snapshot.exerciseSets),
    snapshots.flatMap((snapshot) => snapshot.structureBlocks),
  );
}

async function restorePlanDay(
  tx: DbExecutor,
  userId: string,
  payload: Extract<RecycleBinPayload, { kind: "plan_day" }>,
): Promise<{ ok: true; warnings: string[] } | RestoreFailure> {
  const snapshot = payload.planDay;
  if (!(await ownsPlan(tx, userId, snapshot.day.planId))) {
    return fail(
      "not_found",
      "The training plan this day belonged to has been deleted. Restore the plan first.",
    );
  }
  await insertPlanDaySnapshots(tx, [snapshot]);
  await relinkLogsToDay(tx, userId, snapshot.day, snapshot.linkedWorkoutLogIds);
  await syncPlanDayStatusFromWorkouts(snapshot.day.id, userId, tx);
  return { ok: true, warnings: [] };
}

async function restoreTrainingPlan(
  tx: DbExecutor,
  userId: string,
  payload: Extract<RecycleBinPayload, { kind: "training_plan" }>,
): Promise<{ ok: true; warnings: string[] } | RestoreFailure> {
  const planId = payload.plan.id;
  const plan = reviveRow(trainingPlans, payload.plan);
  // The generation job died with the delete; a pending/generating row would
  // also collide with uq_training_plans_user_in_flight and block new plans.
  if (plan.generationStatus === "pending" || plan.generationStatus === "generating") {
    plan.generationStatus = "failed";
    plan.generationError = "Plan was deleted while it was still generating";
  }
  await tx.insert(trainingPlans).values({ ...plan, userId });
  await insertPlanDaySnapshots(tx, payload.days);

  const dayIds = new Set(payload.days.map((snapshot) => snapshot.day.id));
  const byDay = new Map<string, string[]>();
  const planOnly: string[] = [];
  for (const log of payload.linkedWorkoutLogs) {
    if (log.planDayId && dayIds.has(log.planDayId)) {
      const list = byDay.get(log.planDayId);
      if (list) list.push(log.id);
      else byDay.set(log.planDayId, [log.id]);
    } else {
      planOnly.push(log.id);
    }
  }
  for (const [dayId, logIds] of byDay) {
    await relinkLogsToDay(tx, userId, { id: dayId, planId }, logIds);
  }
  if (planOnly.length) {
    await tx
      .update(workoutLogs)
      .set({ planId })
      .where(
        and(
          inArray(workoutLogs.id, planOnly),
          eq(workoutLogs.userId, userId),
          isNull(workoutLogs.planId),
        ),
      );
  }
  await syncPlanDayStatusesFromWorkouts([...dayIds], userId, tx);
  return { ok: true, warnings: [] };
}

async function restoreItemInTx(
  tx: DbExecutor,
  userId: string,
  item: RecycleBinItem,
): Promise<RecycleBinRestoreResult> {
  const payload = item.payload;
  let outcome: { ok: true; warnings: string[] } | RestoreFailure;
  switch (payload.kind) {
    case "workout_log":
      outcome = await restoreWorkoutLog(tx, userId, payload);
      break;
    case "plan_day":
      outcome = await restorePlanDay(tx, userId, payload);
      break;
    case "training_plan":
      outcome = await restoreTrainingPlan(tx, userId, payload);
      break;
  }
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    entityType: item.entityType as RecycleBinEntityType,
    entityId: item.entityId,
    batchId: item.batchId,
    warnings: outcome.warnings,
  };
}

// Restore order inside a batch: a workout in the batch may point at a plan
// day in the same batch, which must exist before the log's FK is written.
const RESTORE_ORDER: Record<RecycleBinEntityType, number> = {
  training_plan: 0,
  plan_day: 1,
  workout_log: 2,
};

function toListItem(row: Omit<RecycleBinItem, "payload">): RecycleBinListItem {
  return {
    id: row.id,
    entityType: row.entityType as RecycleBinEntityType,
    entityId: row.entityId,
    batchId: row.batchId,
    label: row.label,
    summary: row.summary,
    entityDate: row.entityDate,
    childCount: row.childCount,
    deletedAt: row.deletedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export class RecycleBinStorage {
  async list(userId: string, now: Date = new Date()): Promise<RecycleBinListResponse> {
    const live = and(eq(recycleBinItems.userId, userId), gt(recycleBinItems.expiresAt, now));
    const rows = await db
      .select({
        id: recycleBinItems.id,
        userId: recycleBinItems.userId,
        entityType: recycleBinItems.entityType,
        entityId: recycleBinItems.entityId,
        batchId: recycleBinItems.batchId,
        label: recycleBinItems.label,
        summary: recycleBinItems.summary,
        entityDate: recycleBinItems.entityDate,
        childCount: recycleBinItems.childCount,
        stravaActivityId: recycleBinItems.stravaActivityId,
        garminActivityId: recycleBinItems.garminActivityId,
        deletedAt: recycleBinItems.deletedAt,
        expiresAt: recycleBinItems.expiresAt,
      })
      .from(recycleBinItems)
      .where(live)
      .orderBy(desc(recycleBinItems.deletedAt), desc(recycleBinItems.id))
      .limit(LIST_CAP);
    // Counted separately so the listing cap cannot under-report the total.
    const counted = await db
      .select({ entityType: recycleBinItems.entityType, count: sql<number>`cast(count(*) as int)` })
      .from(recycleBinItems)
      .where(live)
      .groupBy(recycleBinItems.entityType);

    const counts = { total: 0, workout_log: 0, plan_day: 0, training_plan: 0 };
    for (const row of counted) {
      if ((recycleBinEntityTypeEnum as readonly string[]).includes(row.entityType)) {
        counts[row.entityType as RecycleBinEntityType] = row.count;
        counts.total += row.count;
      }
    }
    return { items: rows.map(toListItem), counts };
  }

  /** The item, only if it is the user's and has not expired. */
  async get(
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<RecycleBinItem | undefined> {
    const [row] = await db
      .select()
      .from(recycleBinItems)
      .where(
        and(
          eq(recycleBinItems.id, id),
          eq(recycleBinItems.userId, userId),
          gt(recycleBinItems.expiresAt, now),
        ),
      )
      .limit(1);
    return row;
  }

  async restore(
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<RecycleBinRestoreResult> {
    try {
      return await db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(recycleBinItems)
          .where(
            and(
              eq(recycleBinItems.id, id),
              eq(recycleBinItems.userId, userId),
              gt(recycleBinItems.expiresAt, now),
            ),
          )
          .for("update");
        if (!item) return fail("not_found", NOT_FOUND_MESSAGE);

        const result = await restoreItemInTx(tx, userId, item);
        if (!result.ok) throw new RestoreAbort(result);
        await tx.delete(recycleBinItems).where(eq(recycleBinItems.id, item.id));
        return result;
      });
    } catch (err) {
      if (err instanceof RestoreAbort) return err.result;
      if (isUniqueViolation(err)) return fail("id_conflict", ID_CONFLICT_MESSAGE);
      throw err;
    }
  }

  /** Restore every item of a bulk delete, all or nothing. */
  async restoreBatch(
    userId: string,
    batchId: string,
    now: Date = new Date(),
  ): Promise<RecycleBinBatchRestoreResult> {
    try {
      return await db.transaction(async (tx) => {
        const items = await tx
          .select()
          .from(recycleBinItems)
          .where(
            and(
              eq(recycleBinItems.batchId, batchId),
              eq(recycleBinItems.userId, userId),
              gt(recycleBinItems.expiresAt, now),
            ),
          )
          .for("update");
        if (items.length === 0) return fail("not_found", NOT_FOUND_MESSAGE);

        items.sort(
          (a, b) =>
            RESTORE_ORDER[a.entityType as RecycleBinEntityType] -
            RESTORE_ORDER[b.entityType as RecycleBinEntityType],
        );
        const restored: Array<{ entityType: RecycleBinEntityType; entityId: string }> = [];
        const warnings: string[] = [];
        for (const item of items) {
          const result = await restoreItemInTx(tx, userId, item);
          if (!result.ok) throw new RestoreAbort(result);
          restored.push({ entityType: result.entityType, entityId: result.entityId });
          warnings.push(...result.warnings);
        }
        await tx.delete(recycleBinItems).where(
          inArray(
            recycleBinItems.id,
            items.map((item) => item.id),
          ),
        );
        return { ok: true, batchId, restored, warnings };
      });
    } catch (err) {
      if (err instanceof RestoreAbort) return err.result;
      if (isUniqueViolation(err)) return fail("id_conflict", ID_CONFLICT_MESSAGE);
      throw err;
    }
  }

  /** "Delete forever" for one item. */
  async purgeItem(userId: string, id: string): Promise<boolean> {
    const deleted = await db
      .delete(recycleBinItems)
      .where(and(eq(recycleBinItems.id, id), eq(recycleBinItems.userId, userId)))
      .returning({ id: recycleBinItems.id });
    return deleted.length > 0;
  }

  /** "Empty bin": every item of the user's, expired or not. Returns the count. */
  async emptyBin(userId: string): Promise<number> {
    const deleted = await db
      .delete(recycleBinItems)
      .where(eq(recycleBinItems.userId, userId))
      .returning({ id: recycleBinItems.id });
    return deleted.length;
  }

  /** Cron: drop everything past its expiry. Returns the count. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const deleted = await db
      .delete(recycleBinItems)
      .where(lte(recycleBinItems.expiresAt, now))
      .returning({ id: recycleBinItems.id });
    return deleted.length;
  }
}
