import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { exerciseSets, planDays, structuredExerciseBackfillReviews, trainingPlans, workoutLogs } from "@shared/schema";
import { db } from "../db";
import { parseExercisesFromText } from "../gemini";
import { expandExercisesToPlanDaySetRows, expandExercisesToSetRows } from "./workoutService/parsing";

type OwnerType = "workoutLog" | "planDay";

const HIGH_CONFIDENCE_THRESHOLD = 70;
const BATCH_SIZE = 25;

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
    const parsed = await parseExercisesFromText(item.text, "kg", undefined, item.userId ?? undefined);
    if (!parsed.length) {
      await upsertReviewFlag({ ownerType: item.ownerType, ownerId: item.ownerId, userId: item.userId, status: "needs_manual_review", reason: "parse_returned_no_rows" });
      continue;
    }

    const lowConfidence = parsed.some((e) => (e.confidence ?? 0) < HIGH_CONFIDENCE_THRESHOLD);
    if (item.ownerType === "workoutLog") {
      await db.insert(exerciseSets).values(expandExercisesToSetRows(parsed, item.ownerId));
    } else {
      await db.insert(exerciseSets).values(expandExercisesToPlanDaySetRows(parsed, item.ownerId));
    }

    await upsertReviewFlag({
      ownerType: item.ownerType,
      ownerId: item.ownerId,
      userId: item.userId,
      status: lowConfidence ? "needs_manual_review" : "resolved",
      reason: lowConfidence ? "low_confidence_conversion" : "auto_resolved",
    });
    processed += 1;
  }

  return { queued: queue.length, processed };
}

export async function listBackfillReviews(userId: string) {
  return db.select().from(structuredExerciseBackfillReviews)
    .where(or(eq(structuredExerciseBackfillReviews.userId, userId), isNull(structuredExerciseBackfillReviews.userId)))
    .orderBy(desc(structuredExerciseBackfillReviews.updatedAt))
    .limit(100);
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
