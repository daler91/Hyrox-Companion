/**
 * Session-to-session progression for a strength exercise: what the athlete
 * should do next time, given what they did last time.
 *
 * Shared because two surfaces must never disagree about it. The workout
 * detail's "Next" chip suggests the target to the athlete as they log, and the
 * workout engine's progression updater (server/services/workoutEngine/progression.ts)
 * writes the same target into the next planned session — a plan that said
 * 102.5 kg while the chip said "repeat 100 kg" would teach the athlete to trust
 * neither.
 *
 * Kept free of the schema barrel so it ships to the browser: the rules read a
 * minimal structural set, which the client's ExerciseSet and the server's
 * logged rows both satisfy.
 */

/** The fields of a logged set these rules read. Weights in the athlete's unit. */
export interface ProgressionSet {
  readonly reps?: number | null;
  readonly weight?: number | null;
  readonly plannedReps?: number | null;
  readonly plannedWeight?: number | null;
}

export type ProgressionWeightUnit = "kg" | "lb";

/** A suggested prescription for the next session of an exercise. */
export interface NextTarget {
  /** Same set count as last time — the suggestion changes intensity, not volume. */
  readonly setCount: number;
  readonly reps: number;
  readonly weight: number;
  /**
   * The single thing that moved versus last session, for the "+1 rep" badge —
   * or `repeat`, when last session's prescription was not completed and the
   * target is to go again rather than to progress.
   */
  readonly step:
    | { readonly field: "reps"; readonly amount: 1 }
    | { readonly field: "weight"; readonly amount: number }
    | { readonly field: "repeat" }
    | { readonly field: "deload"; readonly amount: number };
}

// Same bounds as the estimated-1RM PR metric in
// server/services/analyticsService.ts: Epley is only trusted for 2–10 rep
// strength sets, so a suggestion derived from it holds to the same range.
const EPLEY_MIN_REPS = 2;
const EPLEY_MAX_REPS = 10;

export const WEIGHT_INCREMENT: Readonly<Record<ProgressionWeightUnit, number>> = { kg: 2.5, lb: 5 };

// Fallback step for when the standard one above breaks the gain cap: the
// fractional plates a commercial gym stocks. Tried ONLY after the standard step
// has been rejected, so the ordinary reps-vs-weight crossover is unchanged and
// this can only speak where the function used to be silent.
//
// Without it, a beginner at 3x10 with anything at or under 25 kg got no
// suggestion at all, ever — reps are capped at 10, so only the weight step
// remained and it always breached the cap (audit L3).
export const SMALL_WEIGHT_INCREMENT: Readonly<Record<ProgressionWeightUnit, number>> = {
  kg: 1.25,
  lb: 2.5,
};

// A plate jump on a very light implement at the rep ceiling can leap the
// estimated 1RM by 20%+. Past this fraction the suggestion would be a
// programme change, not an overload — stay silent instead.
const MAX_E1RM_GAIN_FRACTION = 0.1;

// How far a deload steps back: 10% off the weight that was missed twice, then
// floored to a real plate. The convention of the linear-progression programmes
// this suggestion mirrors (GreySkull, StrongLifts): enough of a reduction to
// rebuild through, small enough that the rebuilt weight arrives within a few
// sessions.
const DELOAD_FRACTION = 0.1;

export function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The value every set shares on a field, or null when they differ or it is missing. */
function uniformValue(sets: readonly ProgressionSet[], field: "reps" | "weight"): number | null {
  const first = sets[0]?.[field];
  if (first == null) return null;
  return sets.every((set) => set[field] === first) ? first : null;
}

/**
 * The next target for a strength exercise, progressed from its last session.
 *
 * "Last time and stop" leaves the actual decision — what to put on the bar —
 * entirely to the athlete. This closes that gap with the gentlest overload
 * that still beats last session's estimated 1RM: +1 rep at the same weight,
 * or +one plate step (2.5 kg / 5 lb) at the same reps, whichever raises the
 * Epley estimate less. Light work therefore progresses by reps and heavy work
 * by plates, with the crossover decided by the same 1RM math the PR tracker
 * already uses. At the 10-rep ceiling only the plate step remains, so reps
 * build to 10 and then weight moves.
 *
 * A session that did not complete its prescription is NOT progressed from: the
 * target is that same prescription again. Overloading on top of a miss is how
 * the suggestion used to answer "you were given 3x5 @ 100 kg and managed 3
 * reps" with "next time do 102.5" (audit H5).
 *
 * A prescription missed TWICE in a row is not repeated a third time: the
 * suggestion backs off ~10%, floored to a real plate. Repeat alone was a
 * one-session memory — a stalled athlete got the same failed target forever,
 * because their second miss looked exactly like their first (audit register,
 * nextTarget deload). `previousSets` is the session before last; when it is
 * absent the repeat behaviour is unchanged, so callers without history lose
 * nothing.
 *
 * Returns null — no suggestion rather than a bad one — when the maths has no
 * footing: non-strength work, missing or varying weight/reps, sets outside
 * the 2–10 rep Epley range, or an implement so light that even the smallest
 * step stocked would jump the estimate by more than 10%.
 */
export function suggestNextTarget(
  lastSets: readonly ProgressionSet[],
  args: {
    readonly category: string;
    readonly weightUnit: ProgressionWeightUnit;
    /** The session before last, for the missed-twice deload. Optional: without
     *  it a miss repeats, exactly as before this argument existed. */
    readonly previousSets?: readonly ProgressionSet[];
  },
): NextTarget | null {
  if (args.category !== "strength") return null;

  // Before the uniformity gate below, deliberately. The commonest way to miss a
  // prescription is for the last set to drop (5/5/4), which makes the LOGGED
  // reps vary — and repeating a prescription needs no Epley maths, only a
  // prescription that was uniform. Gating this on uniform performance would
  // have gone silent on exactly the sessions it exists to catch.
  const unmet = unmetPrescription(lastSets);
  if (unmet) {
    // Missed twice at the SAME prescription -> back off instead of going again.
    // Exact equality on the stored planned values, not an epsilon: they are
    // recorded numbers, and two prescriptions that differ at all are a changed
    // plan, not a stall.
    const previousUnmet = args.previousSets ? unmetPrescription(args.previousSets) : null;
    if (previousUnmet?.reps === unmet.reps && previousUnmet?.weight === unmet.weight) {
      const deload = deloadFrom(lastSets.length, unmet, args.weightUnit);
      if (deload) return deload;
    }
    return {
      setCount: lastSets.length,
      reps: unmet.reps,
      weight: roundWeight(unmet.weight),
      step: { field: "repeat" },
    };
  }

  const weight = uniformValue(lastSets, "weight");
  const reps = uniformValue(lastSets, "reps");
  if (weight == null || reps == null) return null;
  if (weight <= 0 || reps < EPLEY_MIN_REPS || reps > EPLEY_MAX_REPS) return null;

  return progressFrom(lastSets.length, weight, reps, args.weightUnit);
}

/**
 * Last session's prescription, when the athlete was given one and fell short of
 * it on any set. Null when nothing was prescribed (an ad-hoc log), when the
 * prescription was not uniform across the sets, or when it was met.
 *
 * `plannedReps`/`plannedWeight` sit on the very rows this function already
 * reads. Not looking at them is what let a failed session read as a completed
 * one (audit H5).
 */
export function unmetPrescription(
  sets: readonly ProgressionSet[],
): { readonly reps: number; readonly weight: number } | null {
  let plannedReps: number | null = null;
  let plannedWeight: number | null = null;
  let fellShort = false;

  for (const set of sets) {
    if (set.plannedReps == null || set.plannedWeight == null) return null;
    plannedReps ??= set.plannedReps;
    plannedWeight ??= set.plannedWeight;
    // A prescription that differs set to set is not one target to repeat.
    if (set.plannedReps !== plannedReps || set.plannedWeight !== plannedWeight) return null;
    if ((set.reps ?? 0) < set.plannedReps || (set.weight ?? 0) < set.plannedWeight)
      fellShort = true;
  }

  if (!fellShort || plannedReps == null || plannedWeight == null) return null;
  if (plannedWeight <= 0) return null;
  return { reps: plannedReps, weight: plannedWeight };
}

/**
 * The backed-off target after the same prescription has been missed twice.
 *
 * 10% off the missed weight, floored to the plate step — floored, not rounded,
 * because rounding could land back on a weight barely under the one that just
 * failed twice, and a deload that does not deload is the repeat loop wearing a
 * different badge. Flooring also guarantees the result sits strictly below the
 * missed weight. The fractional-plate grid is tried only after the standard one
 * comes back at zero, the same order as the progression side (audit L3), and a
 * weight too light for even that grid returns null — the caller repeats, since
 * a deload to zero is not a prescription.
 *
 * Reps and set count are the prescription's own: the athlete rebuilds through
 * the same shape at less weight, rather than being handed a different session.
 */
function deloadFrom(
  setCount: number,
  missed: { readonly reps: number; readonly weight: number },
  weightUnit: ProgressionWeightUnit,
): NextTarget | null {
  const reduced = missed.weight * (1 - DELOAD_FRACTION);
  for (const grid of [WEIGHT_INCREMENT[weightUnit], SMALL_WEIGHT_INCREMENT[weightUnit]]) {
    const floored = roundWeight(Math.floor(reduced / grid) * grid);
    if (floored > 0) {
      return {
        setCount,
        reps: missed.reps,
        weight: floored,
        step: { field: "deload", amount: roundWeight(missed.weight - floored) },
      };
    }
  }
  return null;
}

/**
 * The gentlest overload that still beats last session's estimated 1RM.
 *
 * Both gains are computed algebraically rather than as a difference of two
 * Epley products. Epley is linear in each argument, so +1 rep is worth
 * `weight / 30` and +one step is worth `step * (1 + reps / 30)` exactly.
 * Subtracting two products instead drifted 2.7e-15 high and decided the
 * suppression threshold at exactly 25.0 kg on float representation alone
 * (audit L2).
 */
function progressFrom(
  setCount: number,
  weight: number,
  reps: number,
  weightUnit: ProgressionWeightUnit,
): NextTarget | null {
  const increment = WEIGHT_INCREMENT[weightUnit];
  const cap = epley(weight, reps) * MAX_E1RM_GAIN_FRACTION;

  const repsGain = reps < EPLEY_MAX_REPS ? weight / 30 : null;
  const weightGain = increment * (1 + reps / 30);

  if (repsGain != null && repsGain < weightGain) {
    return { setCount, reps: reps + 1, weight, step: { field: "reps", amount: 1 } };
  }

  // Standard step first so the reps-vs-weight crossover above is untouched;
  // the smaller step is only ever reached once the standard one is rejected.
  const step = [increment, SMALL_WEIGHT_INCREMENT[weightUnit]].find(
    (candidate) => candidate * (1 + reps / 30) <= cap,
  );
  if (step == null) return null;

  return {
    setCount,
    reps,
    weight: roundWeight(weight + step),
    step: { field: "weight", amount: step },
  };
}
