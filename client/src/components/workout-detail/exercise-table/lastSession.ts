import type { ExerciseSet } from "@shared/schema";

import type { PatchExerciseSetPayload } from "@/lib/api";
import type { ExerciseSetWithDate } from "@/lib/api/exercises";

import { formatPrescription, type Prescription } from "../../exercise-row/formatPrescription";
import { buildPrimaryMetric, computeUniformity, shouldShowLoad } from "./metrics";

export interface LastSession {
  /** YYYY-MM-DD of the session these sets came from. */
  readonly date: string;
  readonly sets: readonly ExerciseSet[];
}

/**
 * The most recent past session for an exercise.
 *
 * `excludeWorkoutLogId` is load-bearing: opening a completed workout would
 * otherwise quote its own sets back as "last time", since they are in the
 * history too.
 */
export function pickLastSession(
  history: readonly ExerciseSetWithDate[],
  excludeWorkoutLogId?: string | null,
): LastSession | null {
  return pickRecentSessions(history, excludeWorkoutLogId, 1)[0] ?? null;
}

/**
 * The most recent past sessions, newest first.
 *
 * The generalisation `pickLastSession` is built on: each round applies the SAME
 * pick — latest date, then latest log on that date — and then removes the
 * chosen log before going again. Two logs on one day therefore come out as two
 * sessions in time order, exactly as the single-session pick already treated
 * the later of them (audit M13); a rule applied once and a rule applied
 * repeatedly cannot disagree about what a session is.
 *
 * Why more than one session is worth having: a prescription missed ONCE is
 * repeated, and a repeat that is missed again looks identical to the first miss
 * when only the last session is visible — which is how a stalled athlete gets
 * the same failed target forever. The deload rule in `suggestNextTarget` needs
 * the session before last to tell those apart.
 */
export function pickRecentSessions(
  history: readonly ExerciseSetWithDate[],
  excludeWorkoutLogId: string | null | undefined,
  limit: number,
): LastSession[] {
  let candidates = history.filter(
    (set) => !(excludeWorkoutLogId && set.workoutLogId === excludeWorkoutLogId),
  );

  const sessions: LastSession[] = [];
  while (sessions.length < limit && candidates.length > 0) {
    let latest: string | null = null;
    for (const set of candidates) {
      if (!latest || set.date > latest) latest = set.date;
    }
    if (latest == null) break;

    // One WORKOUT LOG, not one date. Selecting on the date alone merged every
    // session logged that day, so an athlete who trained twice saw both
    // sessions' sets as a single "Last time" — doubling the volume shown, and
    // doubling what "Next" then progressed from (audit M13).
    const onLatestDate = candidates.filter((set) => set.date === latest);
    const lastLogId = latestWorkoutLogId(onLatestDate);
    const sets = onLatestDate.filter((set) => set.workoutLogId === lastLogId);
    if (sets.length === 0) break;

    sessions.push({
      date: latest,
      sets: [...sets].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0)),
    });
    // Remove the emitted log — by id AND date, since a null log id can only
    // stand for one session within a single day's picks, not across days.
    candidates = candidates.filter((set) => !(set.date === latest && set.workoutLogId === lastLogId));
  }
  return sessions;
}

/**
 * Which of the day's logs is the later session.
 *
 * `timeOfDayMin` is the only thing separating two same-day logs; a log that
 * never captured a time sorts before one that did, and when neither has a time
 * the last log encountered wins. That last case is a genuine coin-toss — the
 * payload carries nothing else to order them by — but picking ONE session is
 * right regardless of which, because merging two never was.
 */
function latestWorkoutLogId(setsOnOneDate: readonly ExerciseSetWithDate[]): string | null {
  let bestId: string | null = null;
  let bestTime = -1;
  let seen = false;
  for (const set of setsOnOneDate) {
    const time = set.timeOfDayMin ?? -1;
    if (!seen || time >= bestTime) {
      bestId = set.workoutLogId ?? null;
      bestTime = time;
      seen = true;
    }
  }
  return bestId;
}

/**
 * "4 × 8 reps · 80 kg" for a past session.
 *
 * Composed from the same three helpers the row already uses to describe the
 * current sets, so last time and this time can never be formatted differently.
 */
export function summariseLastSession(
  session: LastSession,
  args: {
    readonly exerciseName: string;
    readonly category: string;
    readonly weightUnit: "kg" | "lb";
    readonly distanceUnit: "km" | "miles";
  },
): Prescription {
  const sets = [...session.sets];
  const uniformity = computeUniformity(sets);
  const metric = buildPrimaryMetric(args.exerciseName, uniformity, args.distanceUnit);
  const hasWeight = shouldShowLoad(
    { exerciseName: args.exerciseName, category: args.category, sets },
    metric.field,
  );

  return formatPrescription({
    setCount: sets.length,
    metricValue: metric.value,
    metricSuffix: metric.suffix ?? "",
    metricVaries: metric.varies,
    weightValue: uniformity.weight,
    weightUnit: args.weightUnit,
    weightVaries: uniformity.weightVaries,
    hasWeight,
  });
}

/** The measurable fields "use last" copies forward. */
const CARRIED_FIELDS = ["reps", "weight", "distance", "time"] as const;

/**
 * Patches that fill the current sets from the last session's, pairwise by
 * position.
 *
 * Only overlapping positions are touched — this fills in what to aim for, it
 * does not add or delete sets, so an athlete who has dropped to 3 sets keeps 3.
 * A field the last session left blank is skipped rather than written as null,
 * so "use last" can never erase something already entered.
 */
export function buildUseLastPatches(
  currentSets: readonly ExerciseSet[],
  lastSets: readonly ExerciseSet[],
): Array<{ readonly setId: string; readonly patch: PatchExerciseSetPayload }> {
  const patches: Array<{ setId: string; patch: PatchExerciseSetPayload }> = [];

  for (let i = 0; i < currentSets.length; i++) {
    const current = currentSets[i];
    const last = lastSets[i];
    if (!current || !last) break;

    const patch: PatchExerciseSetPayload = {};
    for (const field of CARRIED_FIELDS) {
      const value = last[field];
      if (value != null) patch[field] = value;
    }
    if (Object.keys(patch).length > 0) patches.push({ setId: current.id, patch });
  }

  return patches;
}
