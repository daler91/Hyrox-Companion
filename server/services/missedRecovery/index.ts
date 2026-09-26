import { type AbsenceRange, isDateExcused } from "@shared/absence";
import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import { RECOVERABLE_WITHIN_DAYS, RECOVERY_WINDOW_DAYS } from "@shared/missedRecovery";
import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type {
  ApplyMissedRecoveryBody,
  ExerciseSet,
  MissedSessionRecoveryPreview,
  PlanDay,
  PlanDayPriority,
  PlanDayRecovery,
  StructureBlockInput,
  TimelineEntry,
  TrainingPlan,
} from "@shared/schema";
import { planDayRecoveryEnum } from "@shared/schema";
import { resolveSessionPriority } from "@shared/sessionPriority";

import { AppError, ErrorCode } from "../../errors";
import { storage } from "../../storage";
import type { PlanDayRecoveryWrite } from "../../storage/plans";
import { deriveRaceDayOverride } from "../../storage/raceDayView";
import { getLocalDateStrSafe } from "../../timezone";
import { enqueueAutoCoachInBackground } from "../autoCoachQueue";
import {
  planMissedSessionRecovery,
  type PlannerInput,
  type PlannerSession,
  type PlannerSessionState,
  shortDate,
  weekOf,
} from "./planner";
import { planShortenedPrescription, type ShortenPlan } from "./shorten";

/**
 * Missed-session recovery: the loader that turns the athlete's plan into the
 * planner's inputs, and the writes that carry out their decision.
 *
 * The preview is built from the same timeline the athlete is looking at
 * (`getTimelinePage`, which applies the same statuses, excused days, race-week
 * days and retired-plan cut-offs), so the numbers in the sheet describe the
 * calendar on screen. Applying re-runs the planner on fresh data and only
 * accepts a day it would still offer.
 */

/** No exercise table and no saved duration: the app's usual assumption of an hour at a moderate effort. */
const ASSUMED_DURATION_MIN = 60;
const ASSUMED_RPE = 5;
/** Timeline entries per page when reading the days around the missed session. */
const WINDOW_PAGE_SIZE = 60;
/** Pages to read before settling for what came back: a dozen entries a day for a month. */
const WINDOW_MAX_PAGES = 6;
/** A shortened session never reads as more than this share of the original, or less than the floor. */
const MIN_SHORTENED_FRACTION = 0.3;
const MAX_SHORTENED_FRACTION = 0.9;
const MIN_SHORTENED_MIN = 10;

interface RecoveryContext {
  readonly day: PlanDay;
  readonly input: PlannerInput;
  readonly shortenPlan: ShortenPlan;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function notMissed(message: string): AppError {
  return new AppError(ErrorCode.CONFLICT, message, 409);
}

/**
 * Whether the day reads "missed" on the timeline right now: stored missed, or
 * still stored planned with its date gone (the nightly sweep has not reached it
 * yet) — and in neither case held out of missed by a declared absence.
 */
function isMissedNow(day: PlanDay, today: string, absences: readonly AbsenceRange[]): boolean {
  if (!day.scheduledDate) return false;
  if (isDateExcused(day.scheduledDate, absences)) return false;
  if (day.status === "missed") return true;
  return day.status === "planned" && day.scheduledDate < today;
}

/** The day's recovery record, read as the timeline reads it: a let-go counts only on a day stored as missed. */
function storedRecovery(day: PlanDay): PlanDayRecovery | null {
  if (!(planDayRecoveryEnum as readonly (string | null)[]).includes(day.recovery)) return null;
  if (day.recovery === "let_go" && day.status !== "missed") return null;
  return day.recovery as PlanDayRecovery;
}

/** The last day a session of `plan` may move to: its final session, or the day before it was retired. */
function lastMoveDate(plan: TrainingPlan | undefined): string | null {
  const end = plan?.endDate ?? null;
  const dayBeforeRetirement = plan?.retiredOn ? addDaysToISODate(plan.retiredOn, -1) : null;
  if (end === null || dayBeforeRetirement === null) return end ?? dayBeforeRetirement;
  // ISO dates: the lexically smaller one is the earlier.
  return dayBeforeRetirement < end ? dayBeforeRetirement : end;
}

interface SessionSize {
  readonly durationMin: number;
  readonly rpe: number;
  readonly estimated: boolean;
}

function sizeOf(
  saved: { readonly durationMin: number | null | undefined; readonly rpe: number | null | undefined },
  blocks: readonly StructureBlockInput[],
  sets: readonly ExerciseSet[],
  distanceUnit: string,
): SessionSize {
  const estimate = estimatePlannedSession({ structureBlocks: blocks, exerciseSets: sets, distanceUnit });
  const durationMin = saved.durationMin ?? estimate.durationMin;
  return {
    durationMin: durationMin ?? ASSUMED_DURATION_MIN,
    rpe: saved.rpe ?? estimate.rpe ?? ASSUMED_RPE,
    estimated: durationMin == null,
  };
}

function entryState(entry: TimelineEntry, today: string): PlannerSessionState {
  if (entry.status === "completed") return "done";
  if (entry.status === "planned" && entry.date >= today) return "planned";
  // Missed, skipped, or a past day an absence excused: none of it is training.
  return "not_happening";
}

function toPlannerSession(entry: TimelineEntry, today: string, distanceUnit: string): PlannerSession | null {
  // Walks and yoga the athlete marked as not training, and rest days, are not sessions.
  if (entry.countsAsTraining === false) return null;
  if (entry.type === "planned" && !entry.priority) return null;
  const logged = entry.status === "completed";
  const size = sizeOf(
    logged
      ? { durationMin: entry.duration, rpe: entry.rpe }
      : { durationMin: entry.expectedDurationMin, rpe: entry.expectedRpe },
    entry.structureBlocks ?? [],
    entry.exerciseSets ?? [],
    distanceUnit,
  );
  return {
    date: entry.date,
    focus: entry.focus,
    priority: entry.priority ?? null,
    state: entryState(entry, today),
    durationMin: size.durationMin,
    rpe: size.rpe,
  };
}

/** Block timing scaled by `keep`, for estimating a shortened session — the blocks themselves are not edited. */
function scaleBlocks(blocks: readonly StructureBlockInput[], keep: number): StructureBlockInput[] {
  const scale = (value: number | null | undefined) => (value == null ? value : value * keep);
  return blocks.map((block) => ({
    ...block,
    durationMinutes: scale(block.durationMinutes),
    durationSeconds: scale(block.durationSeconds),
    timeCapMinutes: scale(block.timeCapMinutes),
    roundCount: scale(block.roundCount),
    rounds: scale(block.rounds),
  }));
}

/**
 * The shortened session's share of the original. From the cut table when the
 * table was cut (five intervals to three is 60%, four to two is 50%);
 * otherwise the athlete is told to do the standard share, so that is it.
 */
function shortenedFraction(
  plan: ShortenPlan,
  blocks: readonly StructureBlockInput[],
  sets: readonly ExerciseSet[],
  distanceUnit: string,
): number {
  if (plan.changes.length === 0) return plan.keepFraction;
  const before = estimatePlannedSession({ structureBlocks: blocks, exerciseSets: sets, distanceUnit }).durationMin;
  const after = estimatePlannedSession({
    structureBlocks: scaleBlocks(blocks, plan.keepFraction),
    exerciseSets: plan.remainingSets,
    distanceUnit,
  }).durationMin;
  if (!before || !after) return plan.keepFraction;
  return clamp(after / before, MIN_SHORTENED_FRACTION, MAX_SHORTENED_FRACTION);
}

/**
 * The days the planner reads: the missed session's week, and — while it can
 * still move — every day it could move to, their weeks, and the day after the
 * last one (a key session the next morning is a caution too).
 */
function plannerWindow(missedDate: string, today: string): { from: string; to: string } {
  const from = weekOf(missedDate);
  if (dayDiff(missedDate, today) > RECOVERABLE_WITHIN_DAYS) {
    return { from, to: addDaysToISODate(from, 6) };
  }
  const lastCandidate = addDaysToISODate(today, RECOVERY_WINDOW_DAYS - 1);
  const weekEnd = addDaysToISODate(weekOf(lastCandidate), 6);
  const dayAfter = addDaysToISODate(lastCandidate, 1);
  return { from, to: weekEnd > dayAfter ? weekEnd : dayAfter };
}

/**
 * The athlete's timeline from `from` to `to`, read newest-first backwards from
 * the window's end. Anchored on the window rather than on today: the
 * timeline's first page leads with the whole upcoming schedule, and on a long
 * plan (or two live ones) that crowds out the very days the planner needs,
 * which would then read as free.
 */
async function loadTimelineWindow(userId: string, from: string, to: string): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];
  let before: string | null = addDaysToISODate(to, 1);
  for (let page = 0; page < WINDOW_MAX_PAGES && before !== null; page++) {
    // Sequential by nature: each page starts where the previous one ended.
    const result = await storage.timeline.getTimelinePage(userId, { limit: WINDOW_PAGE_SIZE, before });
    entries.push(...result.entries);
    const oldest = result.entries.at(-1)?.date;
    // Pages never split a date, so reaching `from` means its whole day is in.
    before = oldest !== undefined && oldest > from ? result.nextCursor : null;
  }
  return entries.filter((entry) => entry.date >= from && entry.date <= to);
}

async function loadRecoveryContext(userId: string, planDayId: string): Promise<RecoveryContext> {
  const [day, user] = await Promise.all([
    storage.plans.getPlanDay(planDayId, userId),
    storage.users.getUser(userId),
  ]);
  if (!day?.scheduledDate) throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
  const missedDate = day.scheduledDate;

  const today = getLocalDateStrSafe(new Date(), user?.userTimezone);
  const distanceUnit = user?.distanceUnit || "km";
  const span = plannerWindow(missedDate, today);
  const [timeline, plans, annotations, sets, blocks] = await Promise.all([
    loadTimelineWindow(userId, span.from, span.to),
    storage.plans.listTrainingPlans(userId),
    storage.timelineAnnotations.list(userId),
    storage.workouts.getExerciseSetsByPlanDay(planDayId, userId),
    storage.workouts.getWorkoutStructureByPlanDay(planDayId, userId),
  ]);
  const plan = plans.find((candidate) => candidate.id === day.planId);
  const absences = annotations.map(({ startDate, endDate }) => ({ startDate, endDate }));

  if (plan?.retiredOn && missedDate >= plan.retiredOn) {
    throw notMissed("This session belongs to a plan you have retired.");
  }
  if (!isMissedNow(day, today, absences)) {
    throw notMissed("This session isn't missed, so there is nothing to recover.");
  }

  const override = deriveRaceDayOverride(missedDate, plan?.raceDate);
  const priority: PlanDayPriority | null = resolveSessionPriority({
    priority: override ? null : day.priority,
    focus: override?.focus ?? day.focus,
    mainWorkout: override?.mainWorkout ?? day.mainWorkout,
  });
  if (!priority) throw notMissed("Rest days don't need recovering.");

  const daySets = sets ?? [];
  const dayBlocks = blocks ?? [];
  const size = sizeOf(
    { durationMin: day.expectedDurationMin, rpe: day.expectedRpe },
    dayBlocks,
    daySets,
    distanceUnit,
  );
  const shortenPlan = planShortenedPrescription(daySets, { blockCount: dayBlocks.length, distanceUnit });
  const fraction = shortenedFraction(shortenPlan, dayBlocks, daySets, distanceUnit);

  const sessions = timeline.flatMap((entry) => {
    if (entry.planDayId === day.id) return [];
    const session = toPlannerSession(entry, today, distanceUnit);
    return session ? [session] : [];
  });

  return {
    day,
    shortenPlan,
    input: {
      today,
      missed: {
        planDayId: day.id,
        date: missedDate,
        focus: override?.focus ?? day.focus,
        priority,
        recovery: storedRecovery(day),
        durationMin: size.durationMin,
        estimated: size.estimated,
        rpe: size.rpe,
        fixedToDate: override !== null,
        shortened: {
          durationMin: Math.max(MIN_SHORTENED_MIN, Math.round(size.durationMin * fraction)),
          // Shown as "about N%": to the nearest 5%, so three intervals of five read 60%.
          keptFraction: Math.round(fraction * 20) / 20,
          changes: shortenPlan.changes,
          notes: shortenPlan.notes,
        },
      },
      sessions,
      absences,
      lastDate: lastMoveDate(plan),
      raceDate: plan?.raceDate ?? null,
    },
  };
}

export async function getMissedSessionRecoveryPreview(
  userId: string,
  planDayId: string,
): Promise<MissedSessionRecoveryPreview> {
  const context = await loadRecoveryContext(userId, planDayId);
  return planMissedSessionRecovery(context.input);
}

async function writeRecovery(userId: string, planDayId: string, write: PlanDayRecoveryWrite): Promise<PlanDay> {
  const result = await storage.plans.applyPlanDayRecovery(planDayId, userId, write);
  if (result.outcome === "not_found") throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
  if (result.outcome === "conflict") {
    throw new AppError(
      ErrorCode.CONFLICT,
      "This session changed while you were deciding. Have another look before choosing.",
      409,
    );
  }
  return result.day;
}

function guardFor(day: PlanDay): PlanDayRecoveryWrite["guard"] {
  return { statuses: [day.status ?? "planned"], scheduledDate: day.scheduledDate, recovery: day.recovery };
}

/**
 * The line a shortened session carries when its table could not show the cut
 * itself (timed blocks, or no table at all), so the instruction travels with
 * the session to the card, the log sheet and the coach. It is stored text,
 * read on other days, so the date is absolute: "on Tuesday" would already be
 * wrong by next week.
 */
function shortenInstruction(context: RecoveryContext): string {
  const percent = Math.round(context.input.missed.shortened.keptFraction * 100);
  return `Shortened after it was missed on ${shortDate(context.input.missed.date)}: do about ${percent}% of it.`;
}

async function moveMissedSession(
  userId: string,
  context: RecoveryContext,
  action: "fold" | "shorten",
  targetDate: string,
): Promise<PlanDay> {
  const preview = planMissedSessionRecovery(context.input);
  const option = action === "fold" ? preview.fold : preview.shorten;
  if (!option.available) {
    throw new AppError(ErrorCode.CONFLICT, option.unavailableReason ?? "This session can't be moved.", 409);
  }
  if (!option.targets.some((target) => target.date === targetDate)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "That day isn't one this session can move to.", 400);
  }

  const { day, shortenPlan } = context;
  const update: PlanDayRecoveryWrite["update"] = {
    scheduledDate: targetDate,
    status: "planned",
    recovery: action === "fold" ? "folded" : "shortened",
    missedOn: day.scheduledDate,
    skipReason: null,
  };
  const write: PlanDayRecoveryWrite =
    action === "fold"
      ? { guard: guardFor(day), update }
      : {
          guard: guardFor(day),
          update: {
            ...update,
            // Pinned when the table cannot say how long the session now is:
            // an athlete-set duration, timed blocks, or free text.
            ...(day.expectedDurationMin != null || shortenPlan.needsInstruction
              ? { expectedDurationMin: context.input.missed.shortened.durationMin }
              : {}),
            ...(shortenPlan.needsInstruction
              ? { notes: [shortenInstruction(context), day.notes].filter(Boolean).join("\n") }
              : {}),
          },
          deleteSetIds: shortenPlan.deleteSetIds,
          setUpdates: shortenPlan.setUpdates,
        };

  const updated = await writeRecovery(userId, day.id, write);
  // The upcoming schedule changed shape: let the coach look at it again.
  enqueueAutoCoachInBackground(userId, "plan-day-rescheduled");
  return updated;
}

async function reopenLetGo(userId: string, planDayId: string): Promise<PlanDay> {
  const day = await storage.plans.getPlanDay(planDayId, userId);
  if (!day) throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
  if (storedRecovery(day) !== "let_go") {
    throw new AppError(ErrorCode.CONFLICT, "Only a session you let go can be reopened.", 409);
  }
  // Letting go overwrote how an already-moved session got here; `missedOn` is
  // only set by a move, so it still says it was moved once. Whether it was
  // shortened on the way is lost, and "folded" is the honest remainder — what
  // matters is that the planner doesn't chase it as if it had never moved.
  return writeRecovery(userId, planDayId, {
    guard: guardFor(day),
    update: { recovery: day.missedOn ? "folded" : null },
  });
}

/**
 * Carry out the athlete's decision. Fold and shorten move the session to the
 * chosen day (back to `planned`, remembering the day it was missed on); let go
 * leaves it where it is and stops the timeline asking; reopen takes a let-go
 * back.
 */
export async function applyMissedSessionRecovery(
  userId: string,
  planDayId: string,
  body: ApplyMissedRecoveryBody,
): Promise<PlanDay> {
  if (body.action === "reopen") return reopenLetGo(userId, planDayId);

  const context = await loadRecoveryContext(userId, planDayId);
  if (body.action === "let_go") {
    // A past day the sweep has not reached yet is stored `planned`; it is
    // missed all the same, so the decision writes the status with it.
    return writeRecovery(userId, planDayId, {
      guard: guardFor(context.day),
      update: { status: "missed", recovery: "let_go" },
    });
  }
  return moveMissedSession(userId, context, body.action, body.targetDate);
}
