import {
  exerciseSets,
  type InsertRecycleBinItem,
  mafWorkoutAnalysis,
  planDays,
  RECYCLE_BIN_PAYLOAD_VERSION,
  RECYCLE_BIN_RETENTION_DAYS,
  type RecycleBinExerciseSetRow,
  recycleBinItems,
  type RecycleBinPayload,
  type RecycleBinPlanDayRow,
  type RecycleBinPlanDaySnapshot,
  type RecycleBinStructureBlockSnapshot,
  trainingPlans,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import type { DbExecutor } from "../db";

/**
 * Snapshot a record graph into `recycle_bin_items` right before it is hard
 * deleted. Every function takes the caller's open transaction so the capture
 * and the delete commit (or roll back) together — a bin row for a record that
 * was never deleted, or a delete with no bin row, are both impossible.
 *
 * Lives in its own module (no import of `./index`) for the same reason as
 * planDayStatus.ts: workouts.ts and plans.ts call in here, and they are
 * themselves dependencies of the composed storage facade.
 */

export interface CaptureOptions {
  /** Shared by every item one bulk delete produces, so one Undo restores them all. */
  readonly batchId?: string;
  readonly now?: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SUMMARY_MAX_CHARS = 140;

export function recycleBinExpiryFor(now: Date): Date {
  return new Date(now.getTime() + RECYCLE_BIN_RETENTION_DAYS * MS_PER_DAY);
}

/** One line, whitespace collapsed, cut to a listing-friendly length. */
export function summarizeText(text: string | null | undefined): string | null {
  if (!text) return null;
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > SUMMARY_MAX_CHARS
    ? `${collapsed.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`
    : collapsed;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function planDayLabel(
  day: Pick<RecycleBinPlanDayRow, "weekNumber" | "dayName" | "focus">,
): string {
  return `Week ${day.weekNumber} · ${capitalize(day.dayName)} · ${day.focus}`;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = grouped.get(k);
    if (list) list.push(row);
    else grouped.set(k, [row]);
  }
  return grouped;
}

interface OwnedChildren {
  setsByOwner: Map<string, RecycleBinExerciseSetRow[]>;
  blocksByOwner: Map<string, RecycleBinStructureBlockSnapshot[]>;
}

/**
 * Exercise sets and structure blocks (with their steps) for a set of owners,
 * keyed by owner id. Three batched selects regardless of how many owners.
 */
async function loadOwnedChildren(
  tx: DbExecutor,
  owner: "workoutLogId" | "planDayId",
  ownerIds: readonly string[],
): Promise<OwnedChildren> {
  if (ownerIds.length === 0) return { setsByOwner: new Map(), blocksByOwner: new Map() };

  const sets = await tx
    .select()
    .from(exerciseSets)
    .where(inArray(exerciseSets[owner], [...ownerIds]))
    .orderBy(asc(exerciseSets.sortOrder), asc(exerciseSets.setNumber));

  const blocks = await tx
    .select()
    .from(workoutStructureBlocks)
    .where(inArray(workoutStructureBlocks[owner], [...ownerIds]))
    .orderBy(asc(workoutStructureBlocks.sortOrder));

  const steps = blocks.length
    ? await tx
        .select()
        .from(workoutStructureSteps)
        .where(
          inArray(
            workoutStructureSteps.blockId,
            blocks.map((b) => b.id),
          ),
        )
        .orderBy(asc(workoutStructureSteps.stepNumber))
    : [];
  const stepsByBlock = groupBy(steps, (step) => step.blockId);

  const blocksByOwner = new Map<string, RecycleBinStructureBlockSnapshot[]>();
  for (const [ownerId, ownerBlocks] of groupBy(blocks, (block) => block[owner])) {
    blocksByOwner.set(
      ownerId,
      ownerBlocks.map((block) => ({ block, steps: stepsByBlock.get(block.id) ?? [] })),
    );
  }

  return { setsByOwner: groupBy(sets, (set) => set[owner]), blocksByOwner };
}

async function insertItems(
  tx: DbExecutor,
  items: InsertRecycleBinItem[],
): Promise<Map<string, string>> {
  if (items.length === 0) return new Map();
  // A record sits in the bin at most once (uq_recycle_bin_items_entity). The
  // only way to hit the conflict is a stale row for the same id, and the
  // fresh snapshot is the one worth keeping.
  const inserted = await tx
    .insert(recycleBinItems)
    .values(items)
    .onConflictDoUpdate({
      target: [recycleBinItems.entityType, recycleBinItems.entityId],
      set: {
        userId: sql`excluded.user_id`,
        batchId: sql`excluded.batch_id`,
        label: sql`excluded.label`,
        summary: sql`excluded.summary`,
        entityDate: sql`excluded.entity_date`,
        childCount: sql`excluded.child_count`,
        stravaActivityId: sql`excluded.strava_activity_id`,
        garminActivityId: sql`excluded.garmin_activity_id`,
        payload: sql`excluded.payload`,
        deletedAt: sql`excluded.deleted_at`,
        expiresAt: sql`excluded.expires_at`,
      },
    })
    .returning({ id: recycleBinItems.id, entityId: recycleBinItems.entityId });
  return new Map(inserted.map((row) => [row.entityId, row.id]));
}

function baseItem(
  userId: string,
  entityType: InsertRecycleBinItem["entityType"],
  entityId: string,
  payload: RecycleBinPayload,
  opts: CaptureOptions,
): Pick<
  InsertRecycleBinItem,
  "userId" | "entityType" | "entityId" | "batchId" | "payload" | "deletedAt" | "expiresAt"
> {
  const now = opts.now ?? new Date();
  return {
    userId,
    entityType,
    entityId,
    batchId: opts.batchId ?? null,
    payload,
    deletedAt: now,
    expiresAt: recycleBinExpiryFor(now),
  };
}

/**
 * Snapshot the user's workout logs among `logIds`. Returns entityId → bin item
 * id for the logs that exist and belong to the user; a log missing from the
 * map was not theirs (or already gone), which callers turn into their usual
 * 404.
 */
export async function captureWorkoutLogs(
  tx: DbExecutor,
  userId: string,
  logIds: readonly string[],
  opts: CaptureOptions = {},
): Promise<Map<string, string>> {
  if (logIds.length === 0) return new Map();
  const logs = await tx
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, userId), inArray(workoutLogs.id, [...logIds])));
  if (logs.length === 0) return new Map();

  const ids = logs.map((log) => log.id);
  const { setsByOwner, blocksByOwner } = await loadOwnedChildren(tx, "workoutLogId", ids);
  // The FK from maf_workout_analysis is SET NULL, not cascade: the analysis
  // rows outlive the delete but forget which log they describe.
  const analyses = await tx
    .select({ id: mafWorkoutAnalysis.id, workoutLogId: mafWorkoutAnalysis.workoutLogId })
    .from(mafWorkoutAnalysis)
    .where(
      and(eq(mafWorkoutAnalysis.userId, userId), inArray(mafWorkoutAnalysis.workoutLogId, ids)),
    );
  const analysesByLog = groupBy(analyses, (row) => row.workoutLogId);

  const items: InsertRecycleBinItem[] = logs.map((log) => {
    const sets = setsByOwner.get(log.id) ?? [];
    return {
      ...baseItem(
        userId,
        "workout_log",
        log.id,
        {
          version: RECYCLE_BIN_PAYLOAD_VERSION,
          kind: "workout_log",
          workout: {
            log,
            exerciseSets: sets,
            structureBlocks: blocksByOwner.get(log.id) ?? [],
            mafWorkoutAnalysisIds: (analysesByLog.get(log.id) ?? []).map((row) => row.id),
          },
        },
        opts,
      ),
      label: log.focus,
      summary: summarizeText(log.mainWorkout),
      entityDate: log.date,
      childCount: sets.length,
      stravaActivityId: log.stravaActivityId,
      garminActivityId: log.garminActivityId,
    };
  });
  return insertItems(tx, items);
}

async function buildPlanDaySnapshots(
  tx: DbExecutor,
  userId: string,
  days: readonly RecycleBinPlanDayRow[],
): Promise<RecycleBinPlanDaySnapshot[]> {
  const dayIds = days.map((day) => day.id);
  const { setsByOwner, blocksByOwner } = await loadOwnedChildren(tx, "planDayId", dayIds);
  // workout_logs.plan_day_id is SET NULL by the delete: the athlete's logged
  // session survives as an unplanned one, and restore re-links it.
  const linkedLogs = dayIds.length
    ? await tx
        .select({ id: workoutLogs.id, planDayId: workoutLogs.planDayId })
        .from(workoutLogs)
        .where(and(eq(workoutLogs.userId, userId), inArray(workoutLogs.planDayId, dayIds)))
    : [];
  const linkedByDay = groupBy(linkedLogs, (log) => log.planDayId);

  return days.map((day) => ({
    day,
    exerciseSets: setsByOwner.get(day.id) ?? [],
    structureBlocks: blocksByOwner.get(day.id) ?? [],
    linkedWorkoutLogIds: (linkedByDay.get(day.id) ?? []).map((log) => log.id),
  }));
}

/**
 * Snapshot the plan days among `dayIds` whose parent plan belongs to the user.
 * Returns entityId → bin item id, like {@link captureWorkoutLogs}.
 */
export async function capturePlanDays(
  tx: DbExecutor,
  userId: string,
  dayIds: readonly string[],
  opts: CaptureOptions = {},
): Promise<Map<string, string>> {
  if (dayIds.length === 0) return new Map();
  const rows = await tx
    .select({ day: planDays })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .where(and(eq(trainingPlans.userId, userId), inArray(planDays.id, [...dayIds])));
  if (rows.length === 0) return new Map();

  const snapshots = await buildPlanDaySnapshots(
    tx,
    userId,
    rows.map((row) => row.day),
  );
  const items: InsertRecycleBinItem[] = snapshots.map((snapshot) => ({
    ...baseItem(
      userId,
      "plan_day",
      snapshot.day.id,
      { version: RECYCLE_BIN_PAYLOAD_VERSION, kind: "plan_day", planDay: snapshot },
      opts,
    ),
    label: planDayLabel(snapshot.day),
    summary: summarizeText(snapshot.day.mainWorkout),
    entityDate: snapshot.day.scheduledDate,
    childCount: snapshot.exerciseSets.length,
  }));
  return insertItems(tx, items);
}

/**
 * Snapshot a whole training plan: the plan row, every day with its prescribed
 * sets and structure, and the workout logs that pointed at the plan or one of
 * its days (both FKs are SET NULL by the delete). Returns the bin item id, or
 * undefined when the plan is not the user's.
 */
export async function captureTrainingPlan(
  tx: DbExecutor,
  userId: string,
  planId: string,
  opts: CaptureOptions = {},
): Promise<string | undefined> {
  const [plan] = await tx
    .select()
    .from(trainingPlans)
    .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
    .limit(1);
  if (!plan) return undefined;

  const days = await tx
    .select()
    .from(planDays)
    .where(eq(planDays.planId, planId))
    .orderBy(asc(planDays.weekNumber), asc(planDays.scheduledDate));
  const dayIds = days.map((day) => day.id);
  const snapshots = await buildPlanDaySnapshots(tx, userId, days);

  const linkedWorkoutLogs = await tx
    .select({ id: workoutLogs.id, planDayId: workoutLogs.planDayId })
    .from(workoutLogs)
    .where(
      and(
        eq(workoutLogs.userId, userId),
        dayIds.length
          ? or(eq(workoutLogs.planId, planId), inArray(workoutLogs.planDayId, dayIds))
          : eq(workoutLogs.planId, planId),
      ),
    );

  const inserted = await insertItems(tx, [
    {
      ...baseItem(
        userId,
        "training_plan",
        plan.id,
        {
          version: RECYCLE_BIN_PAYLOAD_VERSION,
          kind: "training_plan",
          plan,
          days: snapshots,
          linkedWorkoutLogs,
        },
        opts,
      ),
      label: plan.name,
      summary: `${days.length} ${days.length === 1 ? "day" : "days"} · ${plan.totalWeeks} ${plan.totalWeeks === 1 ? "week" : "weeks"}`,
      entityDate: plan.startDate,
      childCount: days.length,
    },
  ]);
  return inserted.get(plan.id);
}
