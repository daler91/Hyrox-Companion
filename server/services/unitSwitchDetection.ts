/**
 * Detect whether an athlete changed their unit preference partway through their
 * logged history — the fact that decides what can safely be done with the L4
 * legacy tail.
 *
 * Rows written before the L4 migration carry no `weight_unit` / `distance_unit`,
 * and the write-time unit is unrecoverable: `users.weight_unit` is a bare scalar
 * with no history. Stamping those rows with the athlete's CURRENT preference is
 * correct for anyone who never switched and wrong by ~2.2x for anyone who did,
 * so the whole question is which athletes are which.
 *
 * The signal is that a unit switch is not a training change. Getting stronger
 * moves ONE exercise, gradually. Toggling kg -> lbs multiplies EVERY exercise by
 * the same factor, on the same day. So this looks for a date where several
 * different exercises all jump by the same conversion factor at once, and
 * reports the evidence rather than acting on it.
 *
 * Nothing here writes. It answers a question; the answer is a decision.
 */

/** kg -> lbs. The same constant `unitConversion` uses, restated so a change
 *  there cannot silently retune the detector. */
const KG_TO_LBS = 2.20462;
/** metres -> feet. A miles athlete stores feet (getStoredDistanceUnit). */
const M_TO_FT = 3.28084;

/**
 * How far a measured ratio may sit from the conversion factor and still count.
 *
 * Generous on purpose: logged values are rounded to the display grid (kg to the
 * half, lbs to the whole), so a converted history never lands exactly on the
 * factor. The discriminating power is not the tolerance — it is the requirement
 * that SEVERAL exercises agree on the same factor on the same day, which
 * training changes do not do.
 */
const RATIO_TOLERANCE = 0.1;

/** Distinct exercises that must agree before a boundary is called a switch. */
const MIN_AGREEING_EXERCISES = 2;

export interface LoggedMeasurement {
  /** Calendar date, YYYY-MM-DD. */
  readonly date: string;
  /** What was logged — `exerciseName`, or `custom:<label>` for a custom row. */
  readonly exercise: string;
  readonly value: number;
}

export interface SwitchEvidence {
  readonly exercise: string;
  readonly medianBefore: number;
  readonly medianAfter: number;
  readonly ratio: number;
}

export interface DetectedSwitch {
  /** First date on the NEW side of the boundary. */
  readonly onDate: string;
  /** "up" = values multiplied (kg -> lbs, m -> ft); "down" = the reverse. */
  readonly direction: "up" | "down";
  readonly expectedFactor: number;
  readonly evidence: readonly SwitchEvidence[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function withinTolerance(ratio: number, factor: number): boolean {
  return Math.abs(ratio - factor) / factor <= RATIO_TOLERANCE;
}

/**
 * One value per exercise per day: the median of that day's sets.
 *
 * Warm-up and working sets of the same lift are separate rows, so a single
 * day's back squat can legitimately span 60 to 140. Comparing raw sets would
 * make that spread look like a scale change; a daily median is stable against
 * it and is what an athlete would call "what I squatted that day".
 */
function dailyMedians(rows: readonly LoggedMeasurement[]): Map<string, Map<string, number>> {
  const collected = new Map<string, Map<string, number[]>>();
  for (const row of rows) {
    if (row.value <= 0) continue;
    let byDate = collected.get(row.exercise);
    if (!byDate) {
      byDate = new Map<string, number[]>();
      collected.set(row.exercise, byDate);
    }
    const list = byDate.get(row.date);
    if (list) list.push(row.value);
    else byDate.set(row.date, [row.value]);
  }

  const out = new Map<string, Map<string, number>>();
  for (const [exercise, byDate] of collected) {
    const medians = new Map<string, number>();
    for (const [date, values] of byDate) medians.set(date, median(values));
    out.set(exercise, medians);
  }
  return out;
}

/**
 * Whether a run of daily medians itself spans a conversion-sized jump.
 *
 * This is what stops the detector reporting the wrong DATE. At a boundary too
 * early in the history, the "after" side still holds pre-switch days, and its
 * median gets dragged up until the ratio happens to land on the factor — the
 * split agrees for the wrong reason. A side that straddles the factor cannot be
 * one uniform scale, so it cannot be one side of a switch.
 */
function straddlesFactor(values: readonly number[], factor: number): boolean {
  if (values.length < 2) return false;
  // ⚡ Bolt Performance Optimization:
  // Replaced Math.min(...values) and Math.max(...values) spread calls with a single O(N) linear scan.
  // This avoids intermediate array allocations and prevents 'Maximum call stack size exceeded'
  // errors when checking large arrays.
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < low) low = v;
    if (v > high) high = v;
  }
  return low > 0 && high / low >= factor * (1 - RATIO_TOLERANCE);
}

/** One exercise's daily medians, sorted ascending by date, plus how far a
 *  boundary sweep has already classified into it. `beforeValues` only ever
 *  grows and `pointer` only ever advances — see `refreshSplit`. */
interface ExerciseSplit {
  readonly exercise: string;
  readonly sorted: readonly (readonly [date: string, value: number])[];
  pointer: number;
  readonly beforeValues: number[];
  /** Cached result of the last `refreshSplit` call; `undefined` = never computed. */
  cachedEntry: SwitchEvidence | null | undefined;
  straddles: boolean;
}

function buildExerciseSplits(perExercise: Map<string, Map<string, number>>): ExerciseSplit[] {
  const splits: ExerciseSplit[] = [];
  for (const [exercise, byDate] of perExercise) {
    const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    splits.push({ exercise, sorted, pointer: 0, beforeValues: [], cachedEntry: undefined, straddles: false });
  }
  return splits;
}

// ⚡ Bolt Performance Optimization:
// `detectUnitSwitch` walks every boundary date and, for each one, used to rescan
// EVERY day of EVERY exercise to split it into before/after (O(boundaries * days)
// - quadratic-ish, and the dominant cost for `script/audit-legacy-unit-rows.ts`
// /`backfill-legacy-unit-rows.ts`, which run this once per athlete with legacy
// rows across the whole user base). Boundaries are walked ascending, so a given
// day only ever needs to move from the "after" side to the "before" side once
// across the whole sweep. `refreshSplit` advances a per-exercise pointer instead
// of rescanning, and only recomputes the (still O(days)) median/straddle check
// when that exercise's own split actually moved since the last boundary -
// bounding the total recompute work by each exercise's own day count rather
// than by boundaries * days.
function refreshSplit(split: ExerciseSplit, boundary: string, factor: number): void {
  let moved = false;
  while (split.pointer < split.sorted.length && split.sorted[split.pointer][0] < boundary) {
    split.beforeValues.push(split.sorted[split.pointer][1]);
    split.pointer++;
    moved = true;
  }
  if (!moved && split.cachedEntry !== undefined) return;

  const afterValues = split.sorted.slice(split.pointer).map(([, value]) => value);
  if (split.beforeValues.length === 0 || afterValues.length === 0) {
    split.cachedEntry = null;
    split.straddles = false;
    return;
  }
  if (straddlesFactor(split.beforeValues, factor) || straddlesFactor(afterValues, factor)) {
    split.cachedEntry = null;
    split.straddles = true;
    return;
  }

  const medianBefore = median(split.beforeValues);
  if (medianBefore <= 0) {
    split.cachedEntry = null;
    split.straddles = false;
    return;
  }
  const medianAfter = median(afterValues);
  split.cachedEntry = { exercise: split.exercise, medianBefore, medianAfter, ratio: medianAfter / medianBefore };
  split.straddles = false;
}

/** Per-exercise medians either side of `boundary`, for exercises logged on both
 *  sides — comparing an exercise against itself is what removes "they started
 *  deadlifting" from the signal. Returns null when either side of any exercise
 *  straddles the factor, i.e. the boundary is in the wrong place. */
function evidenceAt(splits: readonly ExerciseSplit[], boundary: string, factor: number): SwitchEvidence[] | null {
  const evidence: SwitchEvidence[] = [];
  for (const split of splits) {
    refreshSplit(split, boundary, factor);
    if (split.straddles) return null;
    if (split.cachedEntry) evidence.push(split.cachedEntry);
  }
  return evidence;
}

/**
 * The first boundary at which enough exercises agree on one conversion factor.
 *
 * Returns null when nothing agrees — which is the expected answer for an
 * athlete who never switched, and is ALSO the answer for one who switched
 * before logging anything or stopped logging at the switch. That blind spot is
 * structural: with no data on one side of the boundary there is nothing to
 * compare, so a null here is "no evidence of a switch", never "no switch". See
 * `describeUnitPlausibility` for the weak signal that partially covers it.
 */
export function detectUnitSwitch(
  rows: readonly LoggedMeasurement[],
  factor: number,
): DetectedSwitch | null {
  const splits = buildExerciseSplits(dailyMedians(rows));
  const boundaries = [...new Set(rows.map((r) => r.date))].sort((a, b) => a.localeCompare(b));

  for (const boundary of boundaries) {
    const evidence = evidenceAt(splits, boundary, factor);
    if (evidence === null || evidence.length < MIN_AGREEING_EXERCISES) continue;

    for (const [direction, expected] of [
      ["up", factor],
      ["down", 1 / factor],
    ] as const) {
      const agreeing = evidence.filter((e) => withinTolerance(e.ratio, expected));
      if (agreeing.length >= MIN_AGREEING_EXERCISES && agreeing.length === evidence.length) {
        return { onDate: boundary, direction, expectedFactor: expected, evidence: agreeing };
      }
    }
  }
  return null;
}

export function detectWeightUnitSwitch(rows: readonly LoggedMeasurement[]): DetectedSwitch | null {
  return detectUnitSwitch(rows, KG_TO_LBS);
}

export function detectDistanceUnitSwitch(rows: readonly LoggedMeasurement[]): DetectedSwitch | null {
  return detectUnitSwitch(rows, M_TO_FT);
}

export type UnitPlausibility = "consistent" | "suspect" | "unknown";

/**
 * A WEAK second signal, for the case the boundary test structurally cannot see:
 * an athlete who switched and then logged nothing, whose whole history is in
 * the old unit with no discontinuity anywhere.
 *
 * It reads the typical logged weight against what that unit usually looks like.
 * A barbell athlete working in pounds sits well above 100; the same athlete in
 * kilos sits well below it. So a "lbs" athlete whose median logged weight is 60
 * is more likely to be holding kilograms.
 *
 * Deliberately reported, never acted on. A beginner genuinely logging 40 lb
 * dumbbells is indistinguishable from a kg athlete here, and that is exactly
 * why this returns a flag for a human rather than a conversion.
 */
export function describeUnitPlausibility(
  weights: readonly number[],
  currentUnit: "kg" | "lbs",
): UnitPlausibility {
  const positive = weights.filter((w) => w > 0);
  // Too little to say anything. Reporting "consistent" here would launder an
  // absence of evidence into evidence of absence.
  if (positive.length < 5) return "unknown";

  const typical = median([...positive]);
  // The band where the two units genuinely overlap — a real 100 could be either
  // a strong kg lift or a modest lbs one, so no claim is made inside it.
  if (typical >= 60 && typical <= 140) return "unknown";
  if (currentUnit === "lbs") return typical < 60 ? "suspect" : "consistent";
  return typical > 140 ? "suspect" : "consistent";
}
