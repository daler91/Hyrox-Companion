import { inSequence } from "@shared/inSequence";
import { exerciseSets, planDays, structuredExerciseBackfillReviews, trainingPlans, workoutLogs } from "@shared/schema";
import { and, type AnyColumn, asc, desc, eq, gt, isNull, ne, not, or, type SQL, sql } from "drizzle-orm";

import { db } from "../db";
import { parseExercisesFromText } from "../gemini";
import { logger } from "../logger";
import { autoLinkedLogStillPrescription } from "../storage/workouts";
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

/**
 * The characters trimmed off a candidate's text: the ones JavaScript's
 * String.prototype.trim removes (ECMAScript WhiteSpace and LineTerminator),
 * so text made only of a vertical tab, a form feed or a no-break space is
 * empty here as it is to any trim in the app.
 */
const TRIMMED_WHITESPACE =
  " \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

/**
 * The text a candidate is parsed from: its main workout and accessory on their
 * own lines, with the whitespace round them trimmed (TRIMMED_WHITESPACE).
 * Postgres trim() strips spaces only, so a log with no accessory went to the
 * parser ending in a newline, and one with neither text went as "\n": queued,
 * sent to the AI parser, and flagged parse_returned_no_rows.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
function candidateText(mainWorkout: AnyColumn, accessory: AnyColumn): SQL<string> {
  return sql<string>`btrim(coalesce(${mainWorkout}, '') || E'\\n' || coalesce(${accessory}, ''), ${TRIMMED_WHITESPACE}::text)`;
}

export async function runAssistedMigrationBackfill(userId: string) {
  // Backfill cutoff for a batch job, not a window any athlete sees. A day
  // either side changes only which rows this sweep picks up, and the next run
  // picks up the rest.
  // eslint-disable-next-line no-restricted-syntax
  const today = new Date().toISOString().slice(0, 10);
  const logText = candidateText(workoutLogs.mainWorkout, workoutLogs.accessory);
  const candidates = await db.select({
    ownerType: sql<OwnerType>`'workoutLog'`,
    ownerId: workoutLogs.id,
    userId: workoutLogs.userId,
    text: logText,
    // The outer row's id, qualified by hand: in a one-table select Drizzle
    // writes `${workoutLogs.id}` as a bare "id", which inside this subquery is
    // exercise_sets.id. That never matched, so every log read as set-less and
    // the parse added a second copy of the sets a log already had.
    hasSets: sql<number>`exists(select 1 from ${exerciseSets} es where es.workout_log_id = ${workoutLogs}.${sql.identifier(workoutLogs.id.name)})::int`,
  }).from(workoutLogs)
    .where(and(
      eq(workoutLogs.userId, userId),
      gt(workoutLogs.date, sql`${today}::date - interval '90 day'`),
      // Nothing to parse: left out here, so it takes no place in the batch.
      ne(logText, ""),
      // A log an auto link created, linked still or since unlinked: its
      // main_workout and accessory are the plan's prescription whatever the
      // athlete edited (their description lives in prescribed_*), so parsing
      // them would invent performed sets. D12 (CODEBASE_ANALYSIS_2026-10-03)
      not(autoLinkedLogStillPrescription()),
    ))
    .orderBy(desc(workoutLogs.date))
    .limit(BATCH_SIZE);

  const planDayText = candidateText(planDays.mainWorkout, planDays.accessory);
  const upcomingPlanCandidates = await db.select({
    ownerType: sql<OwnerType>`'planDay'`,
    ownerId: planDays.id,
    userId: trainingPlans.userId,
    text: planDayText,
    hasSets: sql<number>`exists(select 1 from ${exerciseSets} es where es.plan_day_id = ${planDays.id})::int`,
  }).from(planDays)
    .innerJoin(trainingPlans, eq(trainingPlans.id, planDays.planId))
    .where(and(eq(trainingPlans.userId, userId), gt(planDays.scheduledDate, today), ne(planDayText, "")))
    .orderBy(asc(planDays.scheduledDate))
    .limit(BATCH_SIZE);

  const queue = [...candidates, ...upcomingPlanCandidates].filter((c) => c.hasSets === 0 && c.text.length > 0);

  // One candidate at a time: each one is a call to the AI parser.
  const migrated = await inSequence(queue, async (item) => {
    try {
      // Recorded against the athlete whose budget the route checked — P6
      // (CODEBASE_ANALYSIS_2026-10-03).
      const parsed = await parseExercisesFromText(item.text, MIGRATION_PARSE_UNITS, undefined, userId);
      if (!parsed.length) {
        await upsertReviewFlag({ ownerType: item.ownerType, ownerId: item.ownerId, userId: item.userId, status: "needs_manual_review", reason: "parse_returned_no_rows" });
        return false;
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
      return true;
    } catch (error) {
      logger.warn({ err: error, ownerType: item.ownerType, ownerId: item.ownerId }, "assisted migration parse failed for candidate; continuing batch");
      await upsertReviewFlag({ ownerType: item.ownerType, ownerId: item.ownerId, userId: item.userId, status: "needs_manual_review", reason: "parse_error" });
      return false;
    }
  });

  return { queued: queue.length, processed: migrated.filter(Boolean).length };
}

export async function listBackfillReviews(userId: string, filter?: { ownerType?: OwnerType; ownerId?: string }) {
  const baseWhere = [or(eq(structuredExerciseBackfillReviews.userId, userId), isNull(structuredExerciseBackfillReviews.userId))];
  if (filter?.ownerType) baseWhere.push(eq(structuredExerciseBackfillReviews.ownerType, filter.ownerType));
  if (filter?.ownerId) baseWhere.push(eq(structuredExerciseBackfillReviews.ownerId, filter.ownerId));

  const q = db.select().from(structuredExerciseBackfillReviews)
    .where(and(...baseWhere))
    .orderBy(desc(structuredExerciseBackfillReviews.updatedAt));

  if (filter?.ownerType && filter?.ownerId) return await q.limit(1);
  return await q.limit(100);
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
