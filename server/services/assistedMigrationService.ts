import { exerciseSets, planDays, structuredExerciseBackfillReviews, trainingPlans, workoutLogs } from "@shared/schema";
import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "../db";
import { parseExercisesFromText } from "../gemini";
import { logger } from "../logger";
import { expandExercisesToPlanDaySetRows, expandExercisesToSetRows } from "./workoutService/parsing";

type OwnerType = "workoutLog" | "planDay";

const HIGH_CONFIDENCE_THRESHOLD = 70;
const BATCH_SIZE = 25;

/**
 * This backfill parses into kg/km regardless of whose text it is, and the rows
 * it writes MUST be stamped with the same units — they are the units the values
 * are actually in.
 *
 * That coupling used to be broken, and silently. Before rows carried a unit, a
 * stored number meant "the athlete's own display unit", so parsing an lbs
 * athlete's text into kg and storing it produced a row that every read path
 * then rendered as lbs: a parsed 100 kg squat displayed as 100 lbs, wrong by
 * 2.2x. The row now says it holds kg, so a unit-aware read converts it instead.
 * The constant exists so the parse target and the stamp cannot drift apart
 * again (audit L4).
 */
const MIGRATION_PARSE_UNITS = { weightUnit: "kg", distanceUnit: "km" } as const;

async function upsertReviewFlag(input: { ownerType: OwnerType; ownerId: string; userId: string | null; status: "needs_manual_review" | "resolved"; reason: string | null }) {
  await db.insert(structuredExerciseBackfillReviews).values({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    userId: input.userId,
    status: input.status,
    reason: input.reason,
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [structuredExerciseBackfillReviews.ownerType, structuredExerciseBackfillReviews.ownerId],
    set: {
      status: input.status,
      reason: input.reason,
      userId: input.userId,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function runAssistedMigrationBackfill(userId: string) {
  // Backfill cutoff for a batch job, not a window any athlete sees. A day
  // either side changes only which rows this sweep picks up, and the next run
  // picks up the rest.
  // eslint-disable-next-line no-restricted-syntax
  const today = new Date().toISOString().slice(0, 10);
  const candidates = await db.select({
    ownerType: sql<OwnerType>`'workoutLog'`,
    ownerId: workoutLogs.id,
    userId: workoutLogs.userId,
    text: sql<string>`trim(coalesce(${workoutLogs.mainWorkout}, '') || '\n' || coalesce(${workoutLogs.accessory}, ''))`,
    hasSets: sql<number>`exists(select 1 from ${exerciseSets} es where es.workout_log_id = ${workoutLogs.id})::int`,
  }).from(workoutLogs)
    .where(and(eq(workoutLogs.userId, userId), gt(workoutLogs.date, sql`${today}::date - interval '90 day'`)))
    .orderBy(desc(workoutLogs.date))
    .limit(BATCH_SIZE);

  const upcomingPlanCandidates = await db.select({
    ownerType: sql<OwnerType>`'planDay'`,
    ownerId: planDays.id,
    userId: trainingPlans.userId,
    text: sql<string>`trim(coalesce(${planDays.mainWorkout}, '') || '\n' || coalesce(${planDays.accessory}, ''))`,
    hasSets: sql<number>`exists(select 1 from ${exerciseSets} es where es.plan_day_id = ${planDays.id})::int`,
  }).from(planDays)
    .innerJoin(trainingPlans, eq(trainingPlans.id, planDays.planId))
    .where(and(eq(trainingPlans.userId, userId), gt(planDays.scheduledDate, today)))
    .orderBy(asc(planDays.scheduledDate))
    .limit(BATCH_SIZE);

  const queue = [...candidates, ...upcomingPlanCandidates].filter((c) => c.hasSets === 0 && c.text.length > 0);

  let processed = 0;
  for (const item of queue) {
    try {
      const parsed = await parseExercisesFromText(item.text, MIGRATION_PARSE_UNITS, undefined, item.userId ?? undefined);
      if (!parsed.length) {
        await upsertReviewFlag({ ownerType: item.ownerType, ownerId: item.ownerId, userId: item.userId, status: "needs_manual_review", reason: "parse_returned_no_rows" });
        continue;
      }

      const lowConfidence = parsed.some((e) => (e.confidence ?? 0) < HIGH_CONFIDENCE_THRESHOLD);
      if (item.ownerType === "workoutLog") {
        await db
          .insert(exerciseSets)
          .values(expandExercisesToSetRows(parsed, item.ownerId, MIGRATION_PARSE_UNITS));
      } else {
        await db
          .insert(exerciseSets)
          .values(expandExercisesToPlanDaySetRows(parsed, item.ownerId, MIGRATION_PARSE_UNITS));
      }

      await upsertReviewFlag({
        ownerType: item.ownerType,
        ownerId: item.ownerId,
        userId: item.userId,
        status: lowConfidence ? "needs_manual_review" : "resolved",
        reason: lowConfidence ? "low_confidence_conversion" : "auto_resolved",
      });
      processed += 1;
    } catch (error) {
      logger.warn({ err: error, ownerType: item.ownerType, ownerId: item.ownerId }, "assisted migration parse failed for candidate; continuing batch");
      await upsertReviewFlag({ ownerType: item.ownerType, ownerId: item.ownerId, userId: item.userId, status: "needs_manual_review", reason: "parse_error" });
    }
  }

  return { queued: queue.length, processed };
}

export async function listBackfillReviews(userId: string, filter?: { ownerType?: OwnerType; ownerId?: string }) {
  const baseWhere = [or(eq(structuredExerciseBackfillReviews.userId, userId), isNull(structuredExerciseBackfillReviews.userId))];
  if (filter?.ownerType) baseWhere.push(eq(structuredExerciseBackfillReviews.ownerType, filter.ownerType));
  if (filter?.ownerId) baseWhere.push(eq(structuredExerciseBackfillReviews.ownerId, filter.ownerId));

  const q = db.select().from(structuredExerciseBackfillReviews)
    .where(and(...baseWhere))
    .orderBy(desc(structuredExerciseBackfillReviews.updatedAt));

  if (filter?.ownerType && filter?.ownerId) return q.limit(1);
  return q.limit(100);
}

async function canUserResolveOwner(ownerType: OwnerType, ownerId: string, userId: string): Promise<boolean> {
  if (ownerType === "workoutLog") {
    const row = await db.select({ id: workoutLogs.id }).from(workoutLogs)
      .where(and(eq(workoutLogs.id, ownerId), eq(workoutLogs.userId, userId)))
      .limit(1);
    return row.length > 0;
  }

  const row = await db.select({ id: planDays.id }).from(planDays)
    .innerJoin(trainingPlans, eq(trainingPlans.id, planDays.planId))
    .where(and(eq(planDays.id, ownerId), eq(trainingPlans.userId, userId)))
    .limit(1);
  return row.length > 0;
}

export async function resolveBackfillReview(ownerType: OwnerType, ownerId: string, userId: string, status: "resolved" | "needs_manual_review", reason: string | null) {
  const allowed = await canUserResolveOwner(ownerType, ownerId, userId);
  if (!allowed) return false;
  await upsertReviewFlag({ ownerType, ownerId, userId, status, reason });
  return true;
}
