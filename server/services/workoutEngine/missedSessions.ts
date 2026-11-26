/**
 * Following the sessions that never happened.
 *
 * A generated plan climbs week on week on the assumption that every session
 * is done, so a missed one leaves the next session a step ahead of the
 * athlete: miss 5x5 @ 100 kg and next week still reads 102.5 kg. This is the
 * part of the adaptation (./adaptation.ts) that reads the plan's own days as
 * well as the logs: each lift of a session that was missed or skipped picks
 * up from the step that was not done (so does its long run,
 * ./missedLongRun.ts), and the hold is taken back if the session returns to
 * the plan (folded into another day, or logged late).
 *
 * Pure, like the rest of the adaptation: the caller says which sessions are
 * not happening and which have returned (planAdaptationService).
 */
import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import type { PlanEngineState, PlanMissHold } from "@shared/schema";
import { storedWeightToDisplay, type WeightUnit } from "@shared/unitConversion";

import { planDeloadWeeks } from "../planBlueprint";
import type {
  AdaptablePlanDay,
  AdaptablePlanSet,
  AdaptationInput,
  MissedPlanSession,
} from "./adaptationTypes";
import {
  applyDecision,
  displayRunDistance,
  equivalentLoad,
  exerciseLabel,
  isAdaptableSet,
  LOAD_HORIZON_DAYS,
  loggedLift,
  LONG_RUN,
  markHeld,
  MAX_STEP_ABOVE_MISS,
  nearDayName,
  recordChange,
  repsOf,
  runUnitLabel,
  setsOf,
  topWeight,
  toWorkingDay,
  type WorkingDay,
} from "./adaptationWorking";
import { implementFor, liftKey } from "./loadMath";
import {
  type ClimbPast,
  heldLongRun,
  holdMissedLongRun,
  LONG_RUN_HOLD_UNIT,
  NOT_YET_IN_RANGE,
  ranSince,
  releaseLongRunHold,
  SAME_DISTANCE_METERS,
  type StepHold,
} from "./missedLongRun";

/** Sessions missed longer ago than this are the return-from-break rule's to handle. */
export const MISSED_SESSION_WINDOW_DAYS = 14;
/**
 * A session from this share of the missed load up to the load itself already
 * repeats the missed step; one below it is the week's lighter exposure.
 */
const REPEATS_STEP_FROM = 0.95;
/** A hold older than this has been trained past: it can no longer be taken back. */
const MISS_HOLD_MAX_AGE_DAYS = 28;
const MAX_ADAPTED_MISSES = 200;
const MAX_MISS_HOLDS = 50;
const MAX_HOLD_SETS = 100;
/** Two loads in the same unit closer than this are the same load. */
const SAME_LOAD_TOLERANCE = 0.01;

/** How the engine state names a miss: the plan day, on the day it was missed. */
export function missKey(miss: { readonly planDayId: string; readonly date: string }): string {
  return `${miss.planDayId}|${miss.date}`;
}

/** One lift of a session that never happened: its heaviest prescribed set. */
interface MissedLift {
  readonly exercise: string;
  /** In the athlete's unit. */
  readonly load: number;
  readonly reps: number;
  /** "4x6 @ 85 kg". */
  readonly text: string;
}

function isHoldablePlanSet(set: AdaptablePlanSet): boolean {
  if (!isAdaptableSet(set) || implementFor(set.exerciseName) === "bodyweight") return false;
  // An unlabelled custom set is no lift in particular (D14).
  return liftKey(set) !== "custom";
}

function missedLifts(miss: MissedPlanSession, unit: WeightUnit): MissedLift[] {
  const byExercise = new Map<string, AdaptablePlanSet[]>();
  for (const set of miss.sets) {
    if (!isHoldablePlanSet(set)) continue;
    const exercise = liftKey(set);
    byExercise.set(exercise, [...(byExercise.get(exercise) ?? []), set]);
  }
  return [...byExercise].map(([exercise, sets]) => {
    const loads = sets.map((set) =>
      storedWeightToDisplay(set.weight ?? 0, { weightUnit: set.weightUnit }, { weightUnit: unit }),
    );
    const load = Math.max(...loads);
    const reps = sets.at(loads.indexOf(load))?.reps ?? 5;
    const uniform = loads.every((each) => each === load) && sets.every((set) => set.reps === reps);
    const text = uniform ? `${sets.length}x${reps} @ ${load} ${unit}` : `${load} ${unit} x ${reps}`;
    return { exercise, load, reps, text };
  });
}

/** Whether the athlete has logged the lift on or after `date`, in any session. */
function trainedSince(input: AdaptationInput, exercise: string, date: string): boolean {
  return input.sets.some(
    (set) => set.date >= date && isAdaptableSet(set) && loggedLift(set) === exercise,
  );
}

function missReason(miss: MissedPlanSession, lift: MissedLift, today: string): string {
  const what = `${nearDayName(miss.date, today)}'s ${exerciseLabel(lift.exercise)} (${lift.text})`;
  const then = "so it picks up from that load rather than jumping ahead";
  // A declared absence is never called a miss (shared/absence.ts).
  if (miss.kind === "excused") return `${what} didn't happen, ${then}`;
  if (miss.kind === "skipped") {
    return `${miss.date >= today ? "you're skipping" : "you skipped"} ${what}, ${then}`;
  }
  return `you missed ${what}, ${then}`;
}

/**
 * Where a hold starts: the first later session of the lift that climbs past
 * the missed step. The lighter exposures before it are passed over, and so is
 * one far above the step (MAX_STEP_ABOVE_MISS). A session at about the missed
 * load comes first when the plan repeats the step itself (the lift's second
 * day that week, a lighter week), and then nothing needs holding. With
 * neither in range, the answer is not in yet.
 */
function firstClimbPast(later: readonly WorkingDay[], lift: MissedLift): ClimbPast {
  for (const [index, day] of later.entries()) {
    const step = equivalentLoad(lift.load, lift.reps, repsOf(day, lift.exercise));
    const top = topWeight(day, lift.exercise);
    if (top > step * (1 + MAX_STEP_ABOVE_MISS)) continue;
    if (top > step + SAME_LOAD_TOLERANCE) return index;
    if (top >= step * REPEATS_STEP_FROM) return "repeats";
  }
  return NOT_YET_IN_RANGE;
}

/**
 * Hold one lift at the step a session never did: its next session repeats the
 * missed load instead of climbing past it, and the ones after resume from
 * there (applyCap). Returns what it lowered; null when nothing needed
 * lowering; NOT_YET_IN_RANGE when no session of the lift in range answers the
 * miss yet.
 */
function holdMissedLift(
  working: readonly WorkingDay[],
  miss: MissedPlanSession,
  lift: MissedLift,
  input: AdaptationInput,
  horizonEnd: string,
): StepHold {
  const later = working.filter(
    (day) =>
      day.day.date > miss.date &&
      day.day.date <= horizonEnd &&
      setsOf(day, lift.exercise).length > 0,
  );
  const start = firstClimbPast(later, lift);
  if (start === NOT_YET_IN_RANGE) return NOT_YET_IN_RANGE;
  if (start === "repeats") return null;
  const targets = later.slice(start);
  const before = new Map<string, number>();
  for (const day of targets) {
    for (const set of setsOf(day, lift.exercise)) before.set(set.id, day.weights.get(set.id) ?? 0);
  }
  const changesBefore = targets.map((day) => day.changes.length);
  applyDecision(
    { log: { id: missKey(miss), date: miss.date }, exercise: lift.exercise, sets: [] },
    {
      kind: "cap",
      load: lift.load,
      reps: lift.reps,
      deload: false,
      reason: missReason(miss, lift, input.today),
      followUp: `${exerciseLabel(lift.exercise)} keeps building from the repeated step`,
      missedStep: true,
    },
    targets,
    { unit: input.weightUnit, fatigued: input.fatigued },
  );
  const sets: PlanMissHold["sets"] = [];
  for (const [index, day] of targets.entries()) {
    for (const set of setsOf(day, lift.exercise)) {
      const from = before.get(set.id);
      const to = day.weights.get(set.id);
      if (from != null && to != null && to !== from) sets.push({ setId: set.id, from, to });
    }
    markHeld(day, miss, day.changes.slice(changesBefore.at(index) ?? 0));
  }
  if (sets.length === 0) return null;
  return {
    planDayId: miss.planDayId,
    missedOn: miss.date,
    exercise: lift.exercise,
    unit: input.weightUnit,
    sets: sets.slice(0, MAX_HOLD_SETS),
  };
}

/** A hold on the long run's distance (./missedLongRun.ts), not on a lift's load. */
function isLongRunHold(hold: PlanMissHold): boolean {
  return hold.exercise === LONG_RUN && hold.unit === LONG_RUN_HOLD_UNIT;
}

/**
 * A load a hold recorded, as the athlete reads loads now. The record is in
 * the unit it was written in. An athlete who has switched between kg and lbs
 * since reads the plan's sets converted (toWorkingDay), so the record is read
 * the same way and the two still compare: the hold can be taken back, and
 * what it left standing can be told, in either unit.
 */
function recordedLoad(value: number, hold: PlanMissHold, unit: WeightUnit): number {
  return storedWeightToDisplay(value, { weightUnit: hold.unit }, { weightUnit: unit });
}

/**
 * Take a hold back: the step it stood for is being done after all, so the
 * loads it lowered return — but only where a set still reads what the hold
 * wrote. A load the athlete edited, or a later log moved, is theirs. `reason`
 * is the coach note's sentence on each day it restores.
 */
function releaseHold(
  working: readonly WorkingDay[],
  hold: PlanMissHold,
  input: AdaptationInput,
  reason: string,
): void {
  if (isLongRunHold(hold)) {
    releaseLongRunHold(working, hold, input, reason);
    return;
  }
  const topBefore = new Map<WorkingDay, number>();
  for (const record of hold.sets) {
    const day = working.find((candidate) => candidate.weights.has(record.setId));
    const current = day?.weights.get(record.setId);
    const wrote = recordedLoad(record.to, hold, input.weightUnit);
    if (!day || current == null || Math.abs(current - wrote) > SAME_LOAD_TOLERANCE) continue;
    if (!topBefore.has(day)) topBefore.set(day, topWeight(day, hold.exercise));
    const planned = recordedLoad(record.from, hold, input.weightUnit);
    day.weights.set(record.setId, planned);
    // The restored load is the plan's own, so a raise this pass builds on it.
    day.startWeights.set(record.setId, planned);
    day.touchedSets.add(record.setId);
  }
  for (const [day, before] of topBefore) {
    recordChange(day, hold.exercise, "raise", before, input.weightUnit);
    day.reasons.push(reason);
  }
}

/** The engine's record of missed sessions, as one pass carries it. */
export interface MissRecord {
  /** Misses already reflected in the plan (missKey), oldest first. */
  readonly adapted: Set<string>;
  /** Holds that can still be taken back. */
  readonly holds: PlanMissHold[];
  /**
   * What a hold was taken back for this pass: lifts, and LONG_RUN. A later
   * miss of the same one held nothing while the earlier hold stood (the plan
   * already repeated its step), so it gets its say again — see
   * holdMissedSessions.
   */
  readonly released: Set<string>;
}

/**
 * Whether the athlete has done since the miss what a hold stands for: the
 * lift, in any session; or, for a long run, a run of about the distance the
 * hold left on its first session.
 */
function doneSince(input: AdaptationInput, hold: PlanMissHold): boolean {
  if (!isLongRunHold(hold)) return trainedSince(input, hold.exercise, hold.missedOn);
  const firstDay = [...input.upcoming]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((day) => heldLongRun(hold, day) ?? [])
    .at(0);
  // None of its sessions is ahead any more: nothing a run could make up.
  return firstDay !== undefined && ranSince(input, hold.missedOn, firstDay.to);
}

/**
 * The day of the first session a hold reached, or null when one of the sets
 * it lowered is no longer ahead: that session has been done (or its day has
 * gone), and the plan has moved on from the held load.
 */
function firstHeldDate(hold: PlanMissHold, aheadDates: ReadonlyMap<string, string>): string | null {
  let first: string | null = null;
  for (const record of hold.sets) {
    const date = aheadDates.get(record.setId);
    if (date === undefined) return null;
    if (first === null || date < first) first = date;
  }
  return first;
}

/** What a pass knows when it settles the holds kept from earlier ones. */
interface SettleContext {
  readonly input: AdaptationInput;
  /** The sessions still not happening on their day (missKey). */
  readonly stillMissed: ReadonlySet<string>;
  /** Held sessions that are sessions again, and the day each is now on. */
  readonly returned: ReadonlyMap<string, string>;
  /** Every set still ahead and its day. */
  readonly aheadDates: ReadonlyMap<string, string>;
}

/**
 * What becomes of a hold: kept as it is; dropped with its loads left
 * standing; or taken back, with the sentence that says why. `sessionBack`
 * marks a hold whose session is in the plan again, whatever becomes of its
 * loads: it counts afresh if it is missed again.
 */
type HoldFate =
  | { readonly kind: "keep" | "drop"; readonly sessionBack?: boolean }
  | { readonly kind: "release"; readonly reason: string; readonly sessionBack?: boolean };

/** The coach note's sentence for a hold taken back: its session returned, or the step was done anyway. */
function releaseReason(hold: PlanMissHold, today: string, why: "returned" | "done"): string {
  const when = nearDayName(hold.missedOn, today);
  const label = exerciseLabel(hold.exercise);
  const planned = isLongRunHold(hold) ? "distance" : "load";
  if (why === "returned") {
    return `${when}'s session is no longer missed, so ${label} returns to its planned ${planned}`;
  }
  const did = isLongRunHold(hold) ? "have run long" : `have trained ${label}`;
  return `you ${did} since ${when}'s session, so it returns to its planned ${planned}`;
}

/**
 * Settle one hold kept from an earlier pass:
 *
 *   - its session is back in the plan ahead of the sessions held for it
 *     (moved to an earlier day, or logged late) → taken back;
 *   - its session is back, but after a session held for it → the loads
 *     stand: that session still comes before the missed step is done;
 *   - its day was deleted → dropped, nothing to take back;
 *   - the step was done anyway before any held session came up (the session
 *     done as a workout of its own) → taken back: it was made up;
 *   - the step was done in a held session, or the miss is long ago → dropped
 *     and the loads stand: the plan has moved on from the held load.
 */
function settleHold(hold: PlanMissHold, ctx: SettleContext): HoldFate {
  const { input } = ctx;
  const firstHeld = firstHeldDate(hold, ctx.aheadDates);
  const key = missKey({ planDayId: hold.planDayId, date: hold.missedOn });
  if (!ctx.stillMissed.has(key)) {
    const backOn = ctx.returned.get(hold.planDayId);
    if (backOn === undefined) return { kind: "drop" };
    if (firstHeld === null || backOn >= firstHeld) return { kind: "drop", sessionBack: true };
    return { kind: "release", reason: releaseReason(hold, input.today, "returned"), sessionBack: true };
  }
  if (dayDiff(hold.missedOn, input.today) > MISS_HOLD_MAX_AGE_DAYS) return { kind: "drop" };
  if (!doneSince(input, hold)) return { kind: "keep" };
  if (firstHeld === null) return { kind: "drop" };
  return { kind: "release", reason: releaseReason(hold, input.today, "done") };
}

/**
 * Open the pass's record of missed sessions, or null when the caller gave
 * none to look at. Each hold kept from an earlier pass is settled here
 * (settleHold), before any log is read, so a raise this pass builds on a
 * restored load.
 */
export function openMissRecord(
  working: readonly WorkingDay[],
  input: AdaptationInput,
  state: PlanEngineState,
): MissRecord | null {
  if (!input.missed) return null;
  const ctx: SettleContext = {
    input,
    stillMissed: new Set(input.missed.map(missKey)),
    returned: input.returnedPlanDays ?? new Map<string, string>(),
    // A day another stage rewrote this pass is still ahead: a held set
    // missing from here belongs to a session gone by.
    aheadDates: new Map(
      input.upcoming
        .filter((day) => day.date >= input.today)
        .flatMap((day) => day.sets.map((set) => [set.id, day.date] as const)),
    ),
  };
  const record: MissRecord = {
    adapted: new Set(state.adaptedMisses ?? []),
    holds: [],
    released: new Set(),
  };
  for (const hold of state.missHolds ?? []) {
    const fate = settleHold(hold, ctx);
    if (fate.sessionBack) {
      record.adapted.delete(missKey({ planDayId: hold.planDayId, date: hold.missedOn }));
    }
    if (fate.kind === "keep") record.holds.push(hold);
    if (fate.kind === "release") {
      releaseHold(working, hold, input, fate.reason);
      record.released.add(hold.exercise);
    }
  }
  return record;
}

/** Where a pass holds for one missed session, and which of its steps. */
interface HoldScope {
  readonly working: readonly WorkingDay[];
  readonly input: AdaptationInput;
  readonly horizonEnd: string;
  /** Only these (lifts, LONG_RUN) when given; every step of the session otherwise. */
  readonly only?: ReadonlySet<string>;
  /** Never these: steps the miss already holds. */
  readonly except?: ReadonlySet<string>;
}

/** What one missed session holds this pass, and whether it has to be looked at again. */
interface MissHolds {
  readonly holds: PlanMissHold[];
  /** A step no session in range answers yet (NOT_YET_IN_RANGE). */
  readonly waiting: boolean;
}

/**
 * What one missed session holds: each of its lifts, and its long run, in the
 * next session that climbs past it. Nothing for a lift the athlete has
 * trained since anyway (or a long run they ran), or for a deload week (no
 * step of the progression was lost).
 */
function holdsFor(miss: MissedPlanSession, scope: HoldScope): MissHolds {
  const { working, input, horizonEnd, only, except } = scope;
  if (planDeloadWeeks(input.plan.totalWeeks).includes(miss.weekNumber)) {
    return { holds: [], waiting: false };
  }
  const wanted = (exercise: string): boolean =>
    (only === undefined || only.has(exercise)) && except?.has(exercise) !== true;
  const steps: StepHold[] = [];
  for (const lift of missedLifts(miss, input.weightUnit)) {
    if (!wanted(lift.exercise) || trainedSince(input, lift.exercise, miss.date)) continue;
    steps.push(holdMissedLift(working, miss, lift, input, horizonEnd));
  }
  if (wanted(LONG_RUN)) steps.push(holdMissedLongRun(working, miss, input, horizonEnd));
  return {
    holds: steps.flatMap((step) => (step === null || step === NOT_YET_IN_RANGE ? [] : [step])),
    waiting: steps.includes(NOT_YET_IN_RANGE),
  };
}

/** The steps (lifts, LONG_RUN) a miss holds in this pass's record. */
function heldSteps(miss: MissedPlanSession, record: MissRecord): Set<string> {
  const key = missKey(miss);
  return new Set(
    record.holds
      .filter((hold) => missKey({ planDayId: hold.planDayId, date: hold.missedOn }) === key)
      .map((hold) => hold.exercise),
  );
}

/**
 * The steps of an already-counted miss that get their say again this pass:
 * the ones a hold was just taken back for, where this miss holds nothing of
 * its own. Two sessions missed with the same lift, read in one pass: the
 * first lowers the sessions ahead, so the second finds the plan already
 * repeating its step and holds nothing. Take the first hold back (its session
 * returned) and, without this, the loads it restores climb straight past the
 * step the second session still has not done.
 */
function stepsToHoldAgain(miss: MissedPlanSession, record: MissRecord): Set<string> {
  const held = heldSteps(miss, record);
  return new Set([...record.released].filter((exercise) => !held.has(exercise)));
}

/**
 * Follow the sessions that never happened. A generated plan climbs week on
 * week on the assumption that every session is done; a missed one leaves the
 * next session a step ahead of the athlete. So each lift of a missed session
 * is held at the missed load — once per miss, like a log — and the hold is
 * remembered so it can be taken back if the session returns.
 *
 * A miss counts once every one of its steps has an answer. One with a step no
 * session in range answers yet (a session skipped near the far edge of the
 * horizon: its next exposure is past it) stays uncounted, and each pass asks
 * again until that session comes into range or the miss is two weeks old.
 * The steps it already holds are not held a second time, so a load the
 * athlete put back stays put.
 */
export function holdMissedSessions(
  working: readonly WorkingDay[],
  input: AdaptationInput,
  record: MissRecord,
  horizonEnd: string,
): Pick<PlanEngineState, "adaptedMisses" | "missHolds"> {
  const { adapted, holds } = record;
  const missed = [...(input.missed ?? [])].sort(
    (a, b) => a.date.localeCompare(b.date) || a.planDayId.localeCompare(b.planDayId),
  );
  const windowStart = addDaysToISODate(input.today, -MISSED_SESSION_WINDOW_DAYS);
  for (const miss of missed) {
    if (miss.date < windowStart) continue;
    const scope: HoldScope = { working, input, horizonEnd };
    if (adapted.has(missKey(miss))) {
      const again = stepsToHoldAgain(miss, record);
      if (again.size > 0) holds.push(...holdsFor(miss, { ...scope, only: again }).holds);
      continue;
    }
    const answer = holdsFor(miss, { ...scope, except: heldSteps(miss, record) });
    holds.push(...answer.holds);
    if (!answer.waiting) adapted.add(missKey(miss));
  }
  return {
    adaptedMisses: [...adapted].slice(-MAX_ADAPTED_MISSES),
    missHolds: holds.slice(-MAX_MISS_HOLDS),
  };
}

// ---------------------------------------------------------------------------
// Saying what a miss changes, for the recovery sheet
// ---------------------------------------------------------------------------

/**
 * What following `miss` would hold, without changing anything: the decision
 * holdMissedSessions makes, on a copy of the upcoming days. The recovery
 * sheet uses it to say what letting a session go does to the sessions after
 * it, before any coach pass has run.
 */
export function previewMissHolds(input: AdaptationInput, miss: MissedPlanSession): PlanMissHold[] {
  const working = input.upcoming
    .filter((day) => day.date >= input.today)
    .map((day) => toWorkingDay(day, input));
  return holdsFor(miss, {
    working,
    input,
    horizonEnd: addDaysToISODate(input.today, LOAD_HORIZON_DAYS),
  }).holds;
}

/** What one hold does to the first session it reaches. */
export interface MissFollowOn {
  /** The lift (or "Long Run"), as the coach note names it. */
  readonly exercise: string;
  /** The first session the hold reaches. */
  readonly date: string;
  /** A lift's sets and reps in that session, "4x6"; empty for a long run, which is only a distance. */
  readonly scheme: string;
  /** Its top load (or its distance) there without the hold and with it, in `unit`. */
  readonly from: number;
  readonly to: number;
  readonly unit: string;
}

/**
 * Each hold as the first session it reaches and the load it leaves there,
 * soonest first. A hold none of whose sets is still ahead says nothing.
 */
export function describeMissHolds(
  holds: readonly PlanMissHold[],
  upcoming: readonly AdaptablePlanDay[],
  distanceUnit = "km",
): MissFollowOn[] {
  const days = [...upcoming].sort((a, b) => a.date.localeCompare(b.date));
  return holds
    .flatMap((hold): MissFollowOn[] => {
      const records = new Map(hold.sets.map((record) => [record.setId, record]));
      const day = days.find((candidate) => candidate.sets.some((set) => records.has(set.id)));
      if (!day) return [];
      if (isLongRunHold(hold)) {
        const run = heldLongRun(hold, day);
        if (!run) return [];
        return [
          {
            exercise: exerciseLabel(hold.exercise),
            date: day.date,
            scheme: "",
            from: displayRunDistance(run.from, distanceUnit),
            to: displayRunDistance(run.to, distanceUnit),
            unit: runUnitLabel(distanceUnit),
          },
        ];
      }
      const lowered = day.sets.flatMap((set) => {
        const record = records.get(set.id);
        return record ? [{ set, record }] : [];
      });
      // The heaviest set the hold left on the day: what the session now tops out at.
      const [first, ...rest] = lowered;
      if (!first) return [];
      let top = first;
      for (const each of rest) {
        if (each.record.to > top.record.to) top = each;
      }
      const count = day.sets.filter((set) => liftKey(set) === hold.exercise).length;
      return [
        {
          exercise: exerciseLabel(hold.exercise),
          date: day.date,
          scheme: top.set.reps == null ? `${count} sets` : `${count}x${top.set.reps}`,
          from: Math.max(...lowered.map((each) => each.record.from)),
          to: top.record.to,
          unit: hold.unit,
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A hold as the athlete reads loads now: a lift's loads in their current
 * unit (recordedLoad). A long run's distances are metres whatever the unit.
 */
function inCurrentUnit(hold: PlanMissHold, unit: WeightUnit): PlanMissHold {
  if (isLongRunHold(hold) || hold.unit === unit) return hold;
  return {
    ...hold,
    unit,
    sets: hold.sets.map((record) => ({
      setId: record.setId,
      from: recordedLoad(record.from, hold, unit),
      to: recordedLoad(record.to, hold, unit),
    })),
  };
}

/**
 * The recorded holds as they stand in the plan now: each with only the sets
 * that still read what the hold wrote, in the unit the athlete reads loads in
 * today. A load or distance the athlete has since changed is theirs, and no
 * longer the hold's to report.
 */
export function standingMissHolds(
  input: AdaptationInput,
  holds: readonly PlanMissHold[],
): PlanMissHold[] {
  const working = input.upcoming
    .filter((day) => day.date >= input.today)
    .map((day) => toWorkingDay(day, input));
  const reads = (hold: PlanMissHold, setId: string, to: number): boolean => {
    const day = working.find((each) => each.day.sets.some((set) => set.id === setId));
    if (isLongRunHold(hold)) {
      const meters = day?.runMeters.get(setId);
      return meters != null && Math.abs(meters - to) <= SAME_DISTANCE_METERS;
    }
    const weight = day?.weights.get(setId);
    return weight != null && Math.abs(weight - to) <= SAME_LOAD_TOLERANCE;
  };
  return holds
    .map((hold) => inCurrentUnit(hold, input.weightUnit))
    .map((hold) => ({
      ...hold,
      sets: hold.sets.filter((record) => reads(hold, record.setId, record.to)),
    }));
}
