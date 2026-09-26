import type { RecoveryNote, RecoveryShortenChange } from "@shared/schema";
import { EXERCISE_DEFINITIONS, normalizeExerciseName } from "@shared/schema/exercises";
import {
  formatDistanceFromMeters,
  getStoredDistanceUnit,
  standardizeParsedDistanceUnit,
  storedDistanceToMeters,
} from "@shared/unitConversion";

/**
 * "Shorten it": the missed session, cut to about {@link SHORTEN_KEEP_FRACTION}
 * of its work, as edits to the plan day's prescribed exercise table.
 *
 * Only whole-number decisions a coach would make are taken. An exercise with
 * several sets loses its last ones (five intervals become three); a single
 * continuous effort — a 10 km run, a 2 km row, 100 wall balls — is scaled.
 * Sets inside a timed structure block (EMOM, AMRAP, intervals) are left
 * alone: dropping rows out of a block would break the structure it describes,
 * so the athlete gets a note to stop early instead. Nothing here reads or
 * writes the database; the service applies the result.
 */

export const SHORTEN_KEEP_FRACTION = 0.6;

/** A single set this small is a single effort, not volume: 5 reps stays 5. */
const MIN_SCALABLE_REPS = 10;

/** The exercise-set fields shortening reads (a structural subset of ExerciseSet). */
export interface ShortenableSet {
  readonly id: string;
  readonly exerciseName: string;
  readonly customLabel: string | null;
  readonly blockId: string | null;
  readonly setNumber: number;
  readonly sortOrder: number | null;
  readonly reps: number | null;
  readonly plannedReps: number | null;
  readonly distance: number | null;
  readonly plannedDistance: number | null;
  readonly time: number | null;
  readonly plannedTime: number | null;
  /** The row's own distance stamp ("m"/"ft"); null on legacy rows. */
  readonly distanceUnit: string | null;
}

/** New values for a set that stays but gets smaller. Only the changed fields are present. */
export interface ShortenedSetUpdate {
  readonly id: string;
  readonly reps?: number;
  readonly plannedReps?: number;
  readonly distance?: number;
  readonly plannedDistance?: number;
  readonly time?: number;
  readonly plannedTime?: number;
}

export interface ShortenPlan {
  readonly keepFraction: number;
  /** Sets removed from the prescription. */
  readonly deleteSetIds: readonly string[];
  readonly setUpdates: readonly ShortenedSetUpdate[];
  /** What the athlete sees in the preview, one line per exercise that changed. */
  readonly changes: readonly RecoveryShortenChange[];
  /** The prescription after the cut, for estimating the new session length. */
  readonly remainingSets: readonly ShortenableSet[];
  /** Why part of the session could not be cut in the table. */
  readonly notes: readonly RecoveryNote[];
  /**
   * The prescription still needs the athlete to stop early somewhere (timed
   * blocks, or a session with no exercise table at all) — the plan day then
   * carries a line saying so.
   */
  readonly needsInstruction: boolean;
}

function exerciseLabel(set: ShortenableSet): string {
  if (set.customLabel?.trim()) return set.customLabel.trim();
  const key = normalizeExerciseName(set.exerciseName);
  return key ? EXERCISE_DEFINITIONS[key].label : set.exerciseName;
}

function groupKey(set: ShortenableSet): string {
  return `${set.exerciseName}\u0000${set.customLabel ?? ""}`;
}

function bySetOrder(a: ShortenableSet, b: ShortenableSet): number {
  return a.setNumber - b.setNumber || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * A scaled distance rounded to something a person would run or row: whole
 * hundreds of metres above a kilometre (tens below), tenths of a mile in feet.
 */
function roundScaledDistance(value: number, stamp: string | null, athleteDistanceUnit: string): number {
  const unit = standardizeParsedDistanceUnit(stamp) ?? getStoredDistanceUnit(athleteDistanceUnit);
  if (unit === "ft") return value >= 5280 ? Math.round(value / 528) * 528 : Math.round(value / 10) * 10;
  return value >= 1000 ? Math.round(value / 100) * 100 : Math.max(10, Math.round(value / 10) * 10);
}

function formatStoredDistance(value: number, stamp: string | null, athleteDistanceUnit: string): string {
  const unit = standardizeParsedDistanceUnit(stamp) ?? getStoredDistanceUnit(athleteDistanceUnit);
  const meters = unit === "ft" ? storedDistanceToMeters(value, "miles") : value;
  if (meters < 1000 && athleteDistanceUnit !== "miles") return `${Math.round(meters)} m`;
  return formatDistanceFromMeters(meters, athleteDistanceUnit);
}

function formatMinutesShort(value: number): string {
  return `${Math.round(value)} min`;
}

/** `value` through `scale` when it is set, as-is otherwise. */
function scaledOr(value: number | null, scale: (value: number) => number): number | null {
  return positive(value) ? scale(value) : value;
}

type ScalableField = Exclude<keyof ShortenedSetUpdate, "id">;

/** The fields `scaled` actually changes on `set`, for a partial update. */
function changedFields(
  set: ShortenableSet,
  scaled: Partial<Record<ScalableField, number | null>>,
): Partial<Record<ScalableField, number>> {
  const out: Partial<Record<ScalableField, number>> = {};
  for (const [field, value] of Object.entries(scaled) as [ScalableField, number | null][]) {
    if (value !== null && value !== set[field]) out[field] = value;
  }
  return out;
}

interface ScaledSingle {
  readonly update: ShortenedSetUpdate;
  readonly change: RecoveryShortenChange;
  readonly remaining: ShortenableSet;
}

/** Scale one continuous effort. Null when there is nothing to scale (a 1 × 5 lift). */
function scaleSingleSet(
  set: ShortenableSet,
  keep: number,
  athleteDistanceUnit: string,
): ScaledSingle | null {
  const label = exerciseLabel(set);
  const scaleTime = (value: number) => Math.max(1, Math.round(value * keep));

  const distance = positive(set.plannedDistance) ? set.plannedDistance : set.distance;
  if (positive(distance)) {
    const next = roundScaledDistance(distance * keep, set.distanceUnit, athleteDistanceUnit);
    if (next >= distance) return null;
    // A distance effort with a time target keeps its pace: the time scales too.
    const scaled = {
      plannedDistance: scaledOr(set.plannedDistance, () => next),
      distance: scaledOr(set.distance, () => next),
      plannedTime: scaledOr(set.plannedTime, scaleTime),
      time: scaledOr(set.time, scaleTime),
    };
    return {
      update: { id: set.id, ...changedFields(set, scaled) },
      change: {
        label,
        from: formatStoredDistance(distance, set.distanceUnit, athleteDistanceUnit),
        to: formatStoredDistance(next, set.distanceUnit, athleteDistanceUnit),
      },
      remaining: { ...set, ...scaled },
    };
  }

  const time = positive(set.plannedTime) ? set.plannedTime : set.time;
  if (positive(time)) {
    const next = scaleTime(time);
    if (next >= time) return null;
    const scaled = { plannedTime: scaledOr(set.plannedTime, () => next), time: scaledOr(set.time, () => next) };
    return {
      update: { id: set.id, ...changedFields(set, scaled) },
      change: { label, from: formatMinutesShort(time), to: formatMinutesShort(next) },
      remaining: { ...set, ...scaled },
    };
  }

  const reps = positive(set.plannedReps) ? set.plannedReps : set.reps;
  if (positive(reps) && reps >= MIN_SCALABLE_REPS) {
    const next = Math.max(1, Math.round(reps * keep));
    const scaled = { plannedReps: scaledOr(set.plannedReps, () => next), reps: scaledOr(set.reps, () => next) };
    return {
      update: { id: set.id, ...changedFields(set, scaled) },
      change: { label, from: `${reps} reps`, to: `${next} reps` },
      remaining: { ...set, ...scaled },
    };
  }
  return null;
}

/**
 * Plan the cut. `blockCount` is how many structure blocks the day carries: their
 * sets are untouched, and the athlete is told to stop at about the same share.
 */
export function planShortenedPrescription(
  sets: readonly ShortenableSet[],
  options: { readonly blockCount: number; readonly distanceUnit: string; readonly keep?: number },
): ShortenPlan {
  const keep = options.keep ?? SHORTEN_KEEP_FRACTION;
  const percent = Math.round(keep * 100);
  const deleteSetIds: string[] = [];
  const setUpdates: ShortenedSetUpdate[] = [];
  const changes: RecoveryShortenChange[] = [];
  const remainingSets: ShortenableSet[] = [];

  const groups = new Map<string, ShortenableSet[]>();
  for (const set of sets) {
    if (set.blockId !== null) {
      remainingSets.push(set);
      continue;
    }
    const list = groups.get(groupKey(set));
    if (list) list.push(set);
    else groups.set(groupKey(set), [set]);
  }

  for (const group of groups.values()) {
    const ordered = [...group].sort(bySetOrder);
    const first = ordered[0];
    if (!first) continue;
    if (ordered.length === 1) {
      const scaled = scaleSingleSet(first, keep, options.distanceUnit);
      if (scaled) {
        setUpdates.push(scaled.update);
        changes.push(scaled.change);
        remainingSets.push(scaled.remaining);
      } else {
        remainingSets.push(first);
      }
      continue;
    }
    const keepCount = Math.max(1, Math.round(ordered.length * keep));
    remainingSets.push(...ordered.slice(0, keepCount));
    if (keepCount < ordered.length) {
      deleteSetIds.push(...ordered.slice(keepCount).map((set) => set.id));
      changes.push({
        label: exerciseLabel(first),
        from: `${ordered.length} sets`,
        to: `${keepCount} ${keepCount === 1 ? "set" : "sets"}`,
      });
    }
  }

  const notes: RecoveryNote[] = [];
  const hasUnblockedSets = groups.size > 0;
  if (options.blockCount > 0) {
    notes.push({
      code: "blocks_not_trimmed",
      tone: "info",
      message: `Timed blocks stay as written — stop after about ${percent}% of the rounds.`,
    });
  } else if (!hasUnblockedSets) {
    notes.push({
      code: "not_trimmable",
      tone: "info",
      message: `There is no exercise table to cut, so the session keeps its text — do about ${percent}% of it.`,
    });
  }

  return {
    keepFraction: keep,
    deleteSetIds,
    setUpdates,
    changes,
    remainingSets,
    notes,
    needsInstruction: options.blockCount > 0 || !hasUnblockedSets || changes.length === 0,
  };
}
