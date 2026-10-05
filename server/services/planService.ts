import type { ExerciseSet, InsertPlanDay, PlanDay, PlanDaySkipReason, TrainingPlanWithDays, UpdatePlanDay, WorkoutLog } from "@shared/schema";
import { exerciseSets, isRunningExerciseName, planDays, trainingPlans, workoutLogs } from "@shared/schema";
import type { DistanceUnit } from "@shared/unitConversion";
import { parse } from "csv-parse/sync";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db, type Tx } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { samplePlanDays } from "../samplePlan";
import { storage } from "../storage";
import { planSlotForMove } from "../storage/planSlot";
import { getLocalDateStrSafe } from "../timezone";
import { invalidateAnalyticsCachesForUser } from "./analyticsRouteCache";
import { enqueueAutoCoachInBackground } from "./autoCoachQueue";
import {
  isCorrectedRecordingSet,
  isUncorrectedRecordingSet,
  releaseStravaActivityInTx,
  stripStravaActivityLabel,
} from "./deviceActivityLink";
import { captureMove } from "./missedRecovery/undo";
import { recordPlanDayMove } from "./planDayMoves";

// Moving a plan day changes the shape of the athlete's upcoming schedule, so
// re-run the auto-coach and let its suggestions/review notes reflect the new
// order. enqueueAutoCoachInBackground owns the singleton key and window that
// collapse a burst of reschedules (dragging three workouts in a row) into one
// job — see services/autoCoachQueue.
function enqueueAutoCoachForReschedule(userId: string): void {
  enqueueAutoCoachInBackground(userId, "plan-day-rescheduled");
}

interface CSVRow {
  Week: string;
  Day: string;
  Focus: string;
  "Main Workout": string;
  "Accessory/Engine Work": string;
  Accessory?: string;
  Notes: string;
}

function getCSVParseOptions() {
  return {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  } as const;
}

function parseCSVContent(csvText: string): unknown[] {
  try {
    return parse(csvText, getCSVParseOptions());
  } catch (error) {
    logger.error({ err: error }, "CSV parse error:");
    return [];
  }
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  return "";
}

function readCSVField(record: unknown, field: string): string {
  if (record === null || typeof record !== "object") return "";
  return toStr(Reflect.get(record, field));
}

export function validateAndMapCSVRows(records: unknown[]): CSVRow[] {
  if (!Array.isArray(records)) return [];

  return records.map((record) => ({
    Week: readCSVField(record, "Week"),
    Day: readCSVField(record, "Day"),
    Focus: readCSVField(record, "Focus"),
    "Main Workout": readCSVField(record, "Main Workout"),
    "Accessory/Engine Work": readCSVField(record, "Accessory/Engine Work"),
    Accessory: readCSVField(record, "Accessory"),
    Notes: readCSVField(record, "Notes"),
  }));
}

function parseCSV(csvText: string): CSVRow[] {
  const records = parseCSVContent(csvText);
  return validateAndMapCSVRows(records);
}

const VALID_DAY_NAMES = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

// Canonicalize to title case so downstream scheduling (which now compares
// case-insensitively) and any UI that renders day names see a consistent value.
function canonicalizeDayName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Any plan that claims to span more than a year is almost certainly the
// result of a typo (someone put "2024" or "52" in the Week column by
// accident). Capping pre-insert keeps `totalWeeks` sane for downstream
// analytics like getPlanWeeklyDensity and the plan header.
const MAX_PLAN_WEEKS = 52;

interface ParsedCSVRows {
  weekNumbers: number[];
  invalidDayNames: string[];
  validRows: { weekNumber: number; dayName: string; row: CSVRow }[];
}

function collectCSVRows(rows: CSVRow[]): ParsedCSVRows {
  const weekNumbers: number[] = [];
  const invalidDayNames: string[] = [];
  const validRows: ParsedCSVRows["validRows"] = [];
  for (const row of rows) {
    const n = Number.parseInt(row.Week, 10);
    if (!Number.isNaN(n) && n > 0) weekNumbers.push(n);
    if (!row.Week || !row.Day) continue;
    const lowered = row.Day.trim().toLowerCase();
    if (!VALID_DAY_NAMES.has(lowered)) {
      invalidDayNames.push(row.Day);
      continue;
    }
    validRows.push({
      weekNumber: Number.parseInt(row.Week, 10) || 1,
      dayName: canonicalizeDayName(row.Day),
      row,
    });
  }
  return { weekNumbers, invalidDayNames, validRows };
}

/** Saves a new plan's days, then reads the whole plan back for the response. */
async function addDaysAndReadBack(
  planId: string,
  userId: string,
  days: InsertPlanDay[],
): Promise<TrainingPlanWithDays> {
  await storage.plans.createPlanDays(days);

  const fullPlan = await storage.plans.getTrainingPlan(planId, userId);
  if (!fullPlan) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to retrieve training plan ${planId} after creation`,
      500,
    );
  }
  return fullPlan;
}

export async function importPlanFromCSV(
  csvContent: string,
  userId: string,
  options?: { fileName?: string; planName?: string },
): Promise<TrainingPlanWithDays> {
  const rows = parseCSV(csvContent);
  if (rows.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "No valid rows found in CSV", 400);
  }

  // Validate everything against the parsed rows BEFORE touching the database.
  // Previously a failed rollback (deleteTrainingPlan) could leave an orphaned
  // empty plan on the user's account.
  const { weekNumbers, invalidDayNames, validRows } = collectCSVRows(rows);

  if (weekNumbers.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "No valid week numbers found in CSV", 400);
  }
  if (invalidDayNames.length > 0) {
    const sample = [...new Set(invalidDayNames)].slice(0, 5).join(", ");
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `CSV contains ${invalidDayNames.length} row(s) with unrecognized Day values (e.g., ${sample}). Use Monday–Sunday.`,
      400,
    );
  }
  if (validRows.length === 0) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "CSV has no rows with both a Week and a Day — plan must have at least one day.",
      400,
    );
  }

  // ⚡ Bolt Performance Optimization:
  // Replaced Math.max(...weekNumbers) spread calls with an O(N) linear scan.
  // This avoids intermediate array allocations and prevents 'Maximum call stack size exceeded'
  // errors when parsing large dynamically generated CSV files.
  let minWeek = Number.POSITIVE_INFINITY;
  let maxWeek = Number.NEGATIVE_INFINITY;
  for (const w of weekNumbers) {
    if (w < minWeek) minWeek = w;
    if (w > maxWeek) maxWeek = w;
  }

  // Use the actual span (max - min + 1) rather than the count of unique weeks
  // so non-contiguous imports (e.g. weeks 1, 3, 5) don't under-report duration
  // and make analytics like workouts-per-week over-estimate.
  const rawSpan = maxWeek - minWeek + 1;
  if (rawSpan > MAX_PLAN_WEEKS) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Plan span is ${rawSpan} weeks, which exceeds the ${MAX_PLAN_WEEKS}-week maximum. Check the Week column for typos (e.g., years or extra digits).`,
      400,
    );
  }
  const totalWeeks = rawSpan;

  const plan = await storage.plans.createTrainingPlan({
    userId,
    name: options?.planName || options?.fileName?.replace(".csv", "") || "Imported Plan",
    sourceFileName: options?.fileName || null,
    totalWeeks,
  });

  const days: InsertPlanDay[] = validRows.map(({ weekNumber, dayName, row }) => ({
    planId: plan.id,
    weekNumber,
    dayName,
    focus: row.Focus || "",
    mainWorkout: row["Main Workout"] || "",
    accessory: row.Accessory || row["Accessory/Engine Work"] || null,
    notes: row.Notes || null,
    status: "planned",
  }));

  return addDaysAndReadBack(plan.id, userId, days);
}

export async function createSamplePlan(
  userId: string,
  options: { goal?: string; raceDate?: string } = {},
): Promise<TrainingPlanWithDays> {
  const plan = await storage.plans.createTrainingPlan({
    userId,
    name: "8-Week Functional Fitness Plan",
    sourceFileName: null,
    totalWeeks: 8,
    // The coach reads the plan's goal (coaching context, insights), so the
    // one the athlete picked in onboarding is kept rather than dropped.
    goal: options.goal || null,
    raceDate: options.raceDate ?? null,
  });

  const days: InsertPlanDay[] = samplePlanDays.map((d) => ({
    planId: plan.id,
    weekNumber: d.week,
    dayName: d.day,
    focus: d.focus,
    mainWorkout: d.main,
    accessory: d.accessory,
    notes: d.notes,
    status: "planned",
  }));

  return addDaysAndReadBack(plan.id, userId, days);
}

/**
 * Moving a missed session to today or later is recovering it — a fold —
 * whichever control did it: the recovery sheet, dragging the card, or "Move
 * to…". Left alone the day kept reading "Missed" on its new, future date,
 * because a stored `missed` outranks the date at read time and the nightly
 * sweep only ever touches planned days. A past day the sweep has not reached
 * yet reads as missed too, so it counts the same.
 */
type MissedSessionMoveFields = Pick<UpdatePlanDay, "status" | "recovery" | "missedOn" | "recoveryUndo">;

async function missedSessionMoveFields(
  existing: PlanDay,
  nextDate: string | null,
  userId: string,
): Promise<MissedSessionMoveFields> {
  const from = existing.scheduledDate;
  if (!nextDate || !from || nextDate === from) return {};
  if (existing.status !== "missed" && existing.status !== "planned") return {};
  const user = await storage.users.getUser(userId);
  const today = getLocalDateStrSafe(new Date(), user?.userTimezone);
  const wasMissed = existing.status === "missed" || from < today;
  if (!wasMissed || nextDate < today) return {};
  // Recorded like any fold, so the card's undo can put it back.
  return { status: "planned", recovery: "folded", missedOn: from, recoveryUndo: captureMove(existing) };
}

/**
 * Write a reschedule, folding the session when `missedSessionMoveFields` says
 * it was missed. That decision rests on a read taken before this write, so
 * the day is locked and re-checked first: a log or a sync that completed it in
 * between must not be flipped back to planned. The move itself still lands —
 * it is what the athlete asked for — just without the fold.
 */
async function writeReschedule(
  dayId: string,
  updates: UpdatePlanDay,
  userId: string,
  existing: PlanDay | null | undefined,
  moveFields: MissedSessionMoveFields,
) {
  const updated =
    !existing || moveFields.status === undefined
      ? await storage.plans.updatePlanDay(dayId, updates, userId)
      : await db.transaction(async (tx) => {
          const [current] = await tx
            .select({ status: planDays.status, scheduledDate: planDays.scheduledDate })
            .from(planDays)
            .where(eq(planDays.id, dayId))
            .for("update");
          const unchanged = current?.status === existing.status && current?.scheduledDate === existing.scheduledDate;
          return storage.plans.updatePlanDay(dayId, unchanged ? { ...updates, ...moveFields } : updates, userId, tx);
        });
  // The athlete's own move, for the coach's record of plan changes; a missed
  // session the move folded is listed as rescheduled after the miss.
  if (existing && updated) {
    const folded = moveFields.recovery === "folded" && updated.recovery === "folded";
    await recordPlanDayMove(userId, {
      planDayId: dayId,
      fromDate: existing.scheduledDate,
      toDate: updated.scheduledDate,
      kind: folded ? "folded" : "moved",
    });
  }
  return updated;
}

/**
 * The plan-scoped day update (`PATCH /api/v1/plans/:planId/days/:dayId`): the
 * stored write as it is, with a new date recorded as the athlete's move.
 */
export async function updatePlanDayRecordingMove(dayId: string, updates: UpdatePlanDay, userId: string) {
  const existing = updates.scheduledDate === undefined ? undefined : await storage.plans.getPlanDay(dayId, userId);
  const updated = await storage.plans.updatePlanDay(dayId, updates, userId);
  if (existing && updated) {
    await recordPlanDayMove(userId, {
      planDayId: dayId,
      fromDate: existing.scheduledDate,
      toDate: updated.scheduledDate,
      kind: "moved",
    });
  }
  return updated;
}

export async function updatePlanDayWithCleanup(
  dayId: string,
  updates: UpdatePlanDay,
  userId: string,
) {
  // Note: previously this path wiped the linked workout_log's exercise_sets
  // whenever mainWorkout changed — a leftover from the free-text-primary
  // model where the sets were derived from the text. In the structured-
  // exercise model, exercise_sets are the source of truth and are owned
  // independently (by the athlete's edits). Keeping the athletes' sets
  // through a prescription-text edit is the whole point of letting them
  // tweak the free text alongside the structured rows. Use the /reparse
  // endpoint when the athlete explicitly wants the text converted into
  // new structured rows.
  const reschedulePending =
    updates.scheduledDate === undefined ? null : { nextDate: updates.scheduledDate ?? null };
  const existing = reschedulePending ? await storage.plans.getPlanDay(dayId, userId) : null;
  const moveFields =
    existing && reschedulePending
      ? await missedSessionMoveFields(existing, reschedulePending.nextDate, userId)
      : {};
  const result = await writeReschedule(dayId, updates, userId, existing, moveFields);

  if (result && existing && reschedulePending) {
    const oldDate = existing.scheduledDate ?? null;
    if (reschedulePending.nextDate !== oldDate) {
      enqueueAutoCoachForReschedule(userId);
    }
  }

  return result;
}

type PlanDayStatus = "planned" | "completed" | "skipped" | "missed";

// Allowed transitions for user-driven status changes. Same-state transitions
// are idempotent (always allowed). The "missed" state is primarily written by
// the nightly cron, but users can correct it (log late = completed, reschedule
// = planned). "skipped → missed" and "missed → skipped" are disallowed to keep
// analytics unambiguous (skipped = user choice; missed = system-detected).
const ALLOWED_TRANSITIONS: Record<PlanDayStatus, readonly PlanDayStatus[]> = {
  planned: ["completed", "skipped", "missed"],
  completed: ["planned", "skipped"],
  missed: ["completed", "planned"],
  skipped: ["planned", "completed"],
};

/**
 * Leaving "completed" folds one linked log's content back onto the plan day
 * and releases the rest. Returns the plan-day columns the caller should
 * write; extracted from updatePlanDayStatus so that transition reads as one
 * step rather than inlining the whole cleanup.
 */
async function foldLinkedLogsBackOntoPlanDay(
  tx: Tx,
  dayId: string,
  userId: string,
): Promise<Partial<UpdatePlanDay>> {
  const carried: Partial<UpdatePlanDay> = {};
    // Newest-first, and deliberately NOT limited to one row: nothing stops
    // several logs pointing at one plan day (there is no unique index on
    // workout_logs.plan_day_id, and the plan-day picker offers days that
    // already have a log, labelled "(logged)"). The timeline renders a
    // plan day's log through a last-write-wins Map and hides standalone
    // logs whose planDayId is set, so the extra rows are invisible here —
    // which is exactly why deleting them all while copying only one back
    // destroyed athlete data nobody could see was at risk.
    const linkedLogs = await tx
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.planDayId, dayId), eq(workoutLogs.userId, userId)))
      .orderBy(desc(workoutLogs.date), desc(workoutLogs.startedAt), desc(workoutLogs.id));
    const [existingLog] = linkedLogs;
    if (existingLog) {
      // Preserve edits made on the workout log back onto the plan day so
      // the un-completed day reflects the user's last-known content —
      // both the free-text fields AND the structured exercise_sets.
      // Previously only the text survived; the athlete's actual logged
      // sets got wiped when they toggled status back to planned, which
      // made re-completing restart from the coach's original prescription
      // instead of their edits.
      // A device recording on the log is a measurement the athlete did not
      // type and cannot re-create, so it is not deleted with the log below:
      // it gets its own row back (exactly what "Unlink Strava activity"
      // does), and the "Strava: <name>" line the sync wrote into the notes
      // goes with it — the day is no longer the recording.
      const releasesRecording = Boolean(existingLog.stravaActivityId);
      carried.focus = existingLog.focus;
      carried.mainWorkout = existingLog.mainWorkout;
      carried.accessory = existingLog.accessory;
      carried.notes = releasesRecording
        ? stripStravaActivityLabel(existingLog.notes, existingLog)
        : existingLog.notes;

      // Snapshot the logged sets, then fold them onto the plan day.
      const logged = athleteLoggedSets(
        existingLog,
        await tx
          .select()
          .from(exerciseSets)
          .where(eq(exerciseSets.workoutLogId, existingLog.id))
          .orderBy(asc(exerciseSets.sortOrder)),
      );
      await foldSetsOntoPlanDay(tx, dayId, existingLog, logged);

      // Delete ONLY the log we just copied onto the plan day — its
      // exercise_sets cascade, but they are already on the day above.
      await tx.delete(workoutLogs).where(eq(workoutLogs.id, existingLog.id));

      // After the delete: the recording's row can only exist once no other
      // row of the athlete's carries the same activity id. The released row
      // keeps that id, so the next sync neither re-imports the activity nor
      // re-completes the day the athlete just reopened. Its set takes the
      // note the athlete wrote on the recording's set, which was not folded
      // onto the day (athleteLoggedSets). D12 (CODEBASE_ANALYSIS_2026-10-03)
      if (releasesRecording) {
        await releaseStravaActivityInTx(
          tx,
          existingLog,
          userId,
          await userDistanceUnit(userId),
          logged.recordingSetNotes,
        );
      }

      // Any other log that pointed at this day keeps all of its data and
      // simply stops being plan-linked, surfacing as a standalone timeline
      // entry. Unlinking rather than deleting is what makes "Reopen
      // workout" the reversible action its button implies: the athlete's
      // sets, RPE, heart-rate and Strava/Garmin activity ids all survive.
      if (linkedLogs.length > 1) {
        await tx
          .update(workoutLogs)
          .set({ planDayId: null, planId: null })
          .where(
            and(
              eq(workoutLogs.planDayId, dayId),
              eq(workoutLogs.userId, userId),
              ne(workoutLogs.id, existingLog.id),
            ),
          );
      }
    }
  return carried;
}

/** What the folded log holds of the athlete's. */
interface AthleteSets {
  sets: ExerciseSet[];
  /**
   * On a log an auto link created and still carries: the set it synthesised
   * from the recording, since corrected by the athlete (isCorrectedRecordingSet).
   * The only running set on the log that stands for prescribed running
   * (standsFor).
   */
  correctedRecordingSet: ExerciseSet | undefined;
  /**
   * The note on the recording's set left out of `sets`, for the set the
   * release writes on the recording's own row (releaseStravaActivityInTx).
   */
  recordingSetNotes: string | null;
}

/**
 * The log's sets minus the one an auto link synthesised from its recording,
 * while the athlete has not corrected it (isUncorrectedRecordingSet):
 * untouched, or saved again with both of the watch's numbers, a note at most.
 * That set describes the recording, which "Reopen workout" releases to its
 * own row with the same set, and its note goes with it (recordingSetNotes),
 * so folding it onto the day as well would put the watch's 6.1 km into the
 * day's prescription. Unlink reads the set the same way (takeRecordingSet).
 * Reopen once left out only a set nobody had saved since the link (version 1,
 * no note), so a run the athlete only annotated was folded onto the day after
 * the prescribed 8 km while the release wrote it again on the recording's
 * row: completing the day again counted the 6.1 km twice. Once the athlete
 * has corrected it, it is theirs and stays (and is named, for standsFor).
 *
 * On a log an auto link created whose link has since been undone, the
 * recording is gone and so is its set (unlinkDeviceActivity takes the
 * uncorrected one off). A set of the recording's exercise left there is one
 * the athlete typed or corrected after all, and the recording it would have
 * corrected was not this session, so none is named. D12
 * (CODEBASE_ANALYSIS_2026-10-03)
 */
function athleteLoggedSets(log: WorkoutLog, sets: ExerciseSet[]): AthleteSets {
  if (!log.autoLinkRecordingOnly || !stillCarriesItsAutoLink(log)) {
    return { sets, correctedRecordingSet: undefined, recordingSetNotes: null };
  }
  const recordingSet = sets.find((set) => isUncorrectedRecordingSet(log, set));
  if (recordingSet) {
    return {
      sets: sets.filter((set) => set !== recordingSet),
      correctedRecordingSet: undefined,
      recordingSetNotes: recordingSet.notes,
    };
  }
  return {
    sets,
    correctedRecordingSet: sets.find((set) => isCorrectedRecordingSet(log, set)),
    recordingSetNotes: null,
  };
}

/**
 * Put the folded log's sets on the plan day, as fresh rows the day owns (the
 * exercise_set_single_owner_check constraint makes in-place ownership swaps
 * illegal).
 *
 * The log's sets are the athlete's version of the session and replace the
 * day's, so the un-completed day reflects their last-known content. Not so
 * for a log an auto link created since D12 (`autoLinkRecordingOnly`), linked
 * still or unlinked and adopted as the athlete's own: it never held the
 * prescription, so an exercise it lacks was not dropped, only not typed. Its
 * sets replace the day's per exercise instead (foldOntoPrescription), and
 * with nothing on it the prescription is left alone. Replacing the whole day
 * dropped the tempo run for the strides added after it, the runs of a HYROX
 * day for the wall balls typed on it, and with nothing on the log (an RPE or
 * a note the only edit) a strength day's 5x5. The marker, not the link
 * columns, says which log this is: unlink clears those.
 *
 * An auto link made before D12 copied the prescription in, so its log has no
 * marker and replaces the day like the athlete's own. So does a marked log
 * the athlete has since filled with a copy of the prescription (seed from
 * plan writes each set with its planned* snapshot): it is the whole session
 * now. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function foldSetsOntoPlanDay(
  tx: Tx,
  dayId: string,
  log: WorkoutLog,
  logged: AthleteSets,
): Promise<void> {
  if (log.autoLinkRecordingOnly && !logged.sets.some(hasPrescriptionSnapshot)) {
    await foldOntoPrescription(tx, dayId, logged);
    return;
  }
  await tx.delete(exerciseSets).where(eq(exerciseSets.planDayId, dayId));
  await insertOnPlanDay(tx, dayId, logged.sets);
}

function hasPrescriptionSnapshot(set: ExerciseSet): boolean {
  return (
    set.plannedReps != null ||
    set.plannedWeight != null ||
    set.plannedDistance != null ||
    set.plannedTime != null
  );
}

/** A set of the day's prescription, as foldOntoPrescription reads it. */
type PrescribedSet = Pick<ExerciseSet, "id" | "exerciseName" | "customLabel" | "sortOrder">;

/** One place in the reopened day's order: a prescribed set it keeps, or one of the athlete's. */
type DaySlot = { kept: PrescribedSet } | { logged: ExerciseSet };

/**
 * Fold an auto-created log's sets onto the day per exercise: each prescribed
 * set the athlete logged a version of (standsFor) gives way to theirs, which
 * take its place in the day's order; every other prescribed set stays where it
 * is, and a set that stands for nothing prescribed (the strides) goes after
 * them all. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function foldOntoPrescription(tx: Tx, dayId: string, logged: AthleteSets): Promise<void> {
  if (logged.sets.length === 0) return;
  const prescribed = await tx
    .select({
      id: exerciseSets.id,
      exerciseName: exerciseSets.exerciseName,
      customLabel: exerciseSets.customLabel,
      sortOrder: exerciseSets.sortOrder,
    })
    .from(exerciseSets)
    .where(eq(exerciseSets.planDayId, dayId))
    .orderBy(asc(exerciseSets.sortOrder));
  const slots = slotsOnPrescription(prescribed, logged);
  const kept = new Set(slots.flatMap((slot) => ("kept" in slot ? [slot.kept.id] : [])));
  const replaced = prescribed.filter((set) => !kept.has(set.id)).map((set) => set.id);
  if (replaced.length > 0) await tx.delete(exerciseSets).where(inArray(exerciseSets.id, replaced));
  const { moved, inserted } = orderSlots(slots);
  for (const { id, sortOrder } of moved) {
    await tx
      .update(exerciseSets)
      .set({ sortOrder, version: sql`${exerciseSets.version} + 1` })
      .where(eq(exerciseSets.id, id));
  }
  await insertOnPlanDay(tx, dayId, inserted);
}

/** The reopened day's order: the prescription, with the athlete's sets in place of those they stand for. */
function slotsOnPrescription(prescribed: PrescribedSet[], logged: AthleteSets): DaySlot[] {
  const placed = new Set<ExerciseSet>();
  const slots: DaySlot[] = [];
  const place = (own: ExerciseSet) => {
    if (placed.has(own)) return;
    placed.add(own);
    slots.push({ logged: own });
  };
  for (const set of prescribed) {
    const theirs = logged.sets.filter((own) => standsFor(own, set, logged));
    if (theirs.length === 0) slots.push({ kept: set });
    else theirs.forEach(place);
  }
  logged.sets.forEach(place);
  return slots;
}

/**
 * Whether a set on the log is the athlete's version of `prescribed`: the same
 * exercise, a custom one by its label (every custom exercise is filed as
 * "custom").
 *
 * Running is the exception: a running set the athlete typed stands for no
 * prescribed run, before unlink or after, whatever the recording was. Nothing
 * on the log tells a run they typed as their version of the prescribed one
 * from strides typed as a 6x100 m "run" on an 8 km day, or a cool-down run on
 * a HYROX day, which add to the session, as they did when the log carried a
 * copy of the prescription before D12. Matched by name, they deleted the
 * 8 km, or every prescribed 1 km run; read as additions, the worst case is a
 * run on the reopened day twice. Only the recording's set the athlete
 * corrected (correctedRecordingSet) stands for prescribed running, all of
 * it: a "Run" recording on a tempo-run day measured the tempo run, under the
 * catalogue's plain "run". Only running is one movement across its catalogue
 * category; rowing shares one with the sled push, cycling with every custom
 * exercise. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
function standsFor(own: ExerciseSet, prescribed: PrescribedSet, logged: AthleteSets): boolean {
  if (isRunningExerciseName(own.exerciseName) && isRunningExerciseName(prescribed.exerciseName)) {
    return own === logged.correctedRecordingSet;
  }
  return exerciseIdentity(own) === exerciseIdentity(prescribed);
}

function exerciseIdentity(set: Pick<ExerciseSet, "exerciseName" | "customLabel">): string {
  const label = set.exerciseName === "custom" ? set.customLabel?.trim().toLowerCase() : undefined;
  return label ? `custom:${label}` : set.exerciseName;
}

/**
 * Sort orders for the reopened day, in slot order. A kept set keeps its own
 * unless the athlete's sets before it need the room, so the common fold moves
 * no prescribed row.
 */
function orderSlots(slots: DaySlot[]): {
  moved: { id: string; sortOrder: number }[];
  inserted: ExerciseSet[];
} {
  const moved: { id: string; sortOrder: number }[] = [];
  const inserted: ExerciseSet[] = [];
  let last = -1;
  for (const slot of slots) {
    if ("kept" in slot) {
      const sortOrder = Math.max(slot.kept.sortOrder ?? 0, last + 1);
      if (sortOrder !== slot.kept.sortOrder) moved.push({ id: slot.kept.id, sortOrder });
      last = sortOrder;
    } else {
      last += 1;
      inserted.push({ ...slot.logged, sortOrder: last });
    }
  }
  return { moved, inserted };
}

/**
 * Insert `sets` as rows the plan day owns. Carry every column across by
 * spreading the row and overriding only ownership. The previous explicit field
 * list silently dropped 17 of them — including the L4 weightUnit/distanceUnit
 * stamps (so re-completing re-read the numbers against the athlete's CURRENT
 * preference, the exact ~2.2x misread the stamp exists to prevent), the
 * planned* prescription snapshot, and the block/step/group structure columns.
 * Spreading also means a column added later is carried by default rather than
 * quietly lost here.
 */
async function insertOnPlanDay(tx: Tx, dayId: string, sets: ExerciseSet[]): Promise<void> {
  if (sets.length === 0) return;
  await tx.insert(exerciseSets).values(
    sets.map(({ id: _id, workoutLogId: _workoutLogId, planDayId: _planDayId, version: _version, ...rest }) => ({
      ...rest,
      workoutLogId: null,
      planDayId: dayId,
    })),
  );
}

/**
 * Whether the auto link that created this log still stands, so its recording
 * (and the set synthesised from it) may still be on the log. Unlink adopts
 * the log as `manual` and clears the link columns; a recording linked to the
 * adopted log later is attached to it, which writes no set.
 */
function stillCarriesItsAutoLink(log: WorkoutLog): boolean {
  return log.source === "strava" && log.deviceLinkSource === "auto";
}

async function userDistanceUnit(userId: string): Promise<DistanceUnit> {
  const user = await storage.users.getUser(userId);
  return (user?.distanceUnit || "km") as DistanceUnit;
}

/** `updatePlanDayStatus` without a status: a date-only move, folding a missed session moved forward. */
async function reschedulePlanDay(dayId: string, scheduledDate: string | null | undefined, userId: string) {
  const updates: Record<string, string | null> = {};
  const reschedule = scheduledDate === undefined ? null : { nextDate: scheduledDate ?? null };
  if (reschedule) {
    updates.scheduledDate = reschedule.nextDate;
  }
  // Snapshot the current date so we only enqueue the coach when the move
  // actually changes the scheduled date. A no-op patch (same date) leaves
  // the coach alone.
  const existing = reschedule ? await storage.plans.getPlanDay(dayId, userId) : null;
  const moveFields =
    existing && reschedule ? await missedSessionMoveFields(existing, reschedule.nextDate, userId) : {};
  const result = await writeReschedule(dayId, updates, userId, existing, moveFields);
  if (
    result &&
    existing &&
    reschedule &&
    reschedule.nextDate !== (existing.scheduledDate ?? null)
  ) {
    enqueueAutoCoachForReschedule(userId);
  }
  return result;
}

export async function updatePlanDayStatus(
  dayId: string,
  {
    status,
    scheduledDate,
    skipReason,
  }: { status?: PlanDayStatus; scheduledDate?: string | null; skipReason?: PlanDaySkipReason | null },
  userId: string,
) {
  // Date-only update: no transition check needed.
  if (!status) return reschedulePlanDay(dayId, scheduledDate, userId);

  // Transition path: do the read, transition check, optional log cleanup,
  // and write inside a single transaction so a concurrent cron or workout
  // mutation can't race the check and sneak through a forbidden from-state.
  const { updatedDay, dateChanged, previousDate, reopened } = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        planId: planDays.planId,
        status: planDays.status,
        scheduledDate: planDays.scheduledDate,
        recovery: planDays.recovery,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(and(eq(planDays.id, dayId), eq(trainingPlans.userId, userId)))
      .for("update");

    if (!current) {
      throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
    }

    const from = current.status as PlanDayStatus;
    if (from !== status && !ALLOWED_TRANSITIONS[from].includes(status)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid plan-day status transition: ${from} → ${status}`,
        400,
      );
    }

    const updates: Record<string, string | null> = { status };
    if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate ?? null;

    // The reason belongs to the skip. Landing on any other status clears it, so
    // un-skipping and re-skipping never resurrects a reason the athlete gave for
    // a decision they have since reversed.
    if (status !== "skipped") {
      updates.skipReason = null;
    } else if (skipReason !== undefined) {
      updates.skipReason = skipReason ?? null;
    }
    // Likewise a let-go belongs to the miss: logged late, the day is no longer
    // something the athlete let go of. A fold or shorten stays — it is where
    // the session came from.
    if (status !== "missed" && current.recovery === "let_go") {
      updates.recovery = null;
    }

    // Only clean up the linked workout log when actually leaving "completed".
    // Running this on same-state idempotent writes (e.g. planned → planned)
    // or transitions that don't involve "completed" would silently destroy
    // user data (R8).
    const leavesCompleted = from === "completed" && status !== "completed";
    if (leavesCompleted) {
      Object.assign(updates, await foldLinkedLogsBackOntoPlanDay(tx, dayId, userId));
    }

    const slot = await planSlotForMove(tx, current.planId, updates.scheduledDate);
    const [row] = await tx
      .update(planDays)
      .set({ ...updates, ...slot })
      .where(eq(planDays.id, dayId))
      .returning();

    const dateChanged =
      scheduledDate !== undefined && (scheduledDate ?? null) !== (current.scheduledDate ?? null);

    return { updatedDay: row, dateChanged, previousDate: current.scheduledDate, reopened: leavesCompleted };
  });

  // Reopening deletes the linked log, unlinks any others and gives a Strava
  // recording its own row back, so the cached analytics slices are stale.
  // After the commit, so a refetch in between cannot re-cache the old rows.
  // D10 (CODEBASE_ANALYSIS_2026-10-03)
  if (reopened) invalidateAnalyticsCachesForUser(userId);

  if (updatedDay && dateChanged) {
    await recordPlanDayMove(userId, {
      planDayId: dayId,
      fromDate: previousDate,
      toDate: updatedDay.scheduledDate,
      kind: "moved",
    });
  }

  if (updatedDay && (status === "completed" || dateChanged)) {
    enqueueAutoCoachInBackground(
      userId,
      status === "completed" ? "plan-day-completed" : "plan-day-rescheduled",
    );
  }

  return updatedDay;
}
