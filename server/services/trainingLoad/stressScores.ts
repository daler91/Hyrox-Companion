// Training load: per-set and per-session stress scores (audit A7: split out of
// trainingLoadService.ts).
//
// The strength stress score (tonnage x RPE x tag modifiers), the bodyweight
// per-rep load and the cardio stress score (duration x intensity factor).
// Between them they define the UTSS scale.
//
// CALIBRATION COUPLING. Every governor threshold, ACWR baseline and
// periodisation reference in this app is calibrated against the UTSS these
// functions produce (see the rpeFactor and bodyweightRepLoadKg comments below).
// The cardio branch takes its objective intensity factor from hrModel.ts, which
// is pinned to the same 0.6 to 2.6 band as the RPE curve here. Do not retune
// either curve, the HR model or a downstream threshold in isolation.

import type { WorkoutLog } from "@shared/schema";
import { storedDistanceToMetersStamped, storedWeightToKg } from "@shared/unitConversion";

import { hrIntensityFactor, hrReserveRatio, powerIntensityFactor } from "./hrModel";
import {
  type AthleteLoadContext,
  type ExerciseLoadTagInput,
  getTag,
  normalizeTags,
  type TrainingLoadSet,
} from "./types";
import { inferWorkoutText, round } from "./utils";

/**
 * The strength RPE multiplier: flat at 1.000 up to RPE 6, then exponential.
 *
 * Deliberately NOT the shape the cardio branch uses (`0.6 + (rpe/10)^2 * 2`,
 * monotonic across the whole range), and deliberately left alone (audit M25).
 *
 * The two curves differ because the fatigue does. Cardiovascular stress scales
 * relatively cleanly down toward zero with effort, but sub-maximal strength
 * fatigue is driven mostly by base mechanical volume: 5x5 back squat at RPE 5
 * still imposes real mechanical tension and neurological demand. If this decayed
 * below RPE 6 the way the cardio curve does, heavy low-RPE speed and technique
 * work — which is genuinely fatiguing — would score near-zero UTSS.
 *
 * So `max(0, rpe - 6)` encodes a specific claim: below RPE 6 tonnage alone
 * dictates the load, and an exponential effort penalty applies only once sets
 * begin approaching muscular failure at RPE 7+. That is why a deload at RPE 4
 * scores the same as the same tonnage at RPE 6 — the tonnage IS the stimulus.
 *
 * Changing it would move UTSS for every sub-RPE-6 strength set ever logged, and
 * with it every governor threshold and ACWR baseline calibrated against the
 * current scale — an unnecessary recalibration of the whole governor for a curve
 * that already matches how strength fatigue accumulates.
 */
function rpeFactor(rpe: number | null | undefined): number {
  if (!rpe) return 1;
  return round(Math.pow(1.18, Math.max(0, rpe - 6)), 3);
}

export function calculateStrengthStressScore(
  set: Pick<
    TrainingLoadSet,
    | "reps"
    | "weight"
    | "plannedReps"
    | "plannedWeight"
    | "distance"
    | "plannedDistance"
    | "weightUnit"
    | "distanceUnit"
  >,
  tag: ExerciseLoadTagInput,
  rpe?: number | null,
  weightUnit: string = "kg",
  /** Canonical kg, for scaling unweighted reps (audit M2). */
  athleteBodyweightKg?: number | null,
  /** The athlete's distance preference, for legacy rows with no stamp. */
  distanceUnit?: string | null,
): number {
  const reps = Number(set.reps ?? set.plannedReps ?? 0);
  // UTSS must represent physiological load, not the athlete's display unit, so
  // normalize the stored weight to canonical kg before computing tonnage. This
  // keeps the absolute governor thresholds and the weighted-vs-bodyweight mix
  // comparable across kg and lb athletes. Read-only: we never write this back.
  //
  // A row carrying its own unit stamp is converted from THAT unit, so an
  // athlete who switched preference no longer has their pre-switch training
  // silently re-priced (audit L4). A legacy row still falls back to the current
  // preference, which is the same assumption this line made before — right
  // until the athlete switches, and unfixable without knowing what they used to
  // prefer.
  const weight = storedWeightToKg(Number(set.weight ?? set.plannedWeight ?? 0), set, {
    weightUnit,
  });
  // Same treatment for distance: the branch below used to read the raw stored
  // number, so a distance-only strength set (a carry, a sled push) scored
  // 3.28x higher for an athlete whose rows are stored in feet (C4). Canonical
  // metres, from the row's own stamp where it has one.
  const distance = storedDistanceToMetersStamped(
    Number(set.distance ?? set.plannedDistance ?? 0),
    set,
    { distanceUnit: distanceUnit ?? undefined },
  );
  let weightedTonnage = 0;
  if (weight > 0 && reps > 0) {
    weightedTonnage = weight * Math.max(reps, 1);
  } else if (reps > 0) {
    weightedTonnage = reps * bodyweightRepLoadKg(athleteBodyweightKg);
  } else if (distance > 0) {
    weightedTonnage = distance * 0.08;
  }
  if (weightedTonnage <= 0) return 0;
  const modifier = Math.max(0.4, tag.axialLoadModifier) * Math.max(0.6, tag.eccentricRiskModifier);
  return round((weightedTonnage / 100) * rpeFactor(rpe) * modifier, 2);
}

// Per-rep tonnage for an UNWEIGHTED rep, in kg.
//
// This was a flat 20 for everyone, so a burpee, a pull-up and a wall ball were
// identical load and a 100 kg athlete's set scored exactly the same as a 55 kg
// athlete's (audit M2). `users.bodyweightKg` never reached the load model at
// all. Bodyweight movements plainly scale with the body being moved, so the
// per-rep figure is now proportional to it.
//
// Deliberately expressed as a RATIO against a reference bodyweight rather than
// as an absolute fraction of body mass. Every governor threshold, ACWR
// baseline and periodisation reference in this app is calibrated against the
// existing UTSS scale; multiplying bodyweight tonnage by ~2.6x (0.65 x 80 kg
// vs 20) would silently recalibrate all of them. Anchoring at 75 kg leaves the
// median athlete exactly where they were and only changes the ratio BETWEEN
// athletes, which is the part that was wrong.
//
// Still one number for every movement. Genuinely per-movement fractions (a
// pull-up moves more of the body than a wall ball) need a field on
// `ExerciseLoadTagInput` and a calibrated value per tag row; that is follow-up
// work and is not invented here.
const BODYWEIGHT_REP_LOAD_KG = 20;
const BODYWEIGHT_REP_REFERENCE_KG = 75;

export function bodyweightRepLoadKg(bodyweightKg?: number | null): number {
  if (bodyweightKg == null || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) {
    return BODYWEIGHT_REP_LOAD_KG;
  }
  // Bounded so an implausible profile value cannot dominate the load model.
  const ratio = Math.min(2, Math.max(0.5, bodyweightKg / BODYWEIGHT_REP_REFERENCE_KG));
  return round(BODYWEIGHT_REP_LOAD_KG * ratio, 2);
}

// Priority: objective HR → objective power → logged RPE → high-risk exercise →
// keyword heuristic. The HR/power branches only engage when the workout carries
// that data, so legacy logs fall straight through to the original RPE/keyword
// path (unchanged). The keyword fallback stays a coarse heuristic with known
// blind spots (no negation handling — "not easy" still matches "easy").
function inferCardioIntensityFactor(
  log: Pick<
    WorkoutLog,
    "rpe" | "avgHeartrate" | "avgWatts" | "focus" | "mainWorkout" | "accessory" | "notes"
  >,
  sets: TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput>,
  athlete?: AthleteLoadContext,
): number {
  const hrr = hrReserveRatio(log.avgHeartrate, athlete);
  if (hrr != null) return hrIntensityFactor(hrr);
  const powerIf = powerIntensityFactor(log.avgWatts, athlete?.ftp);
  if (powerIf != null) return powerIf;
  if (log.rpe) {
    return round(0.6 + Math.pow(log.rpe / 10, 2) * 2, 2);
  }
  const highRisk = sets.some(
    (set) => getTag(tags, set.exerciseName, set.category).highIntensityRunningRisk >= 0.75,
  );
  if (highRisk) return 2.3;
  const text = inferWorkoutText(log);
  if (/\b(sprint|interval|track|hill|threshold|tempo|zone\s*[45]|z[45])\b/.test(text)) return 2.1;
  if (/\b(long|road|downhill)\b/.test(text)) return 1.35;
  if (/\b(recovery|easy|zone\s*2|z2|maf)\b/.test(text)) return 0.9;
  return 1.1;
}

export function calculateCardioStressScore(
  log: Pick<
    WorkoutLog,
    | "duration"
    | "rpe"
    | "avgHeartrate"
    | "avgWatts"
    | "focus"
    | "mainWorkout"
    | "accessory"
    | "notes"
  >,
  sets: TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput> = normalizeTags([]),
  athlete?: AthleteLoadContext,
): number {
  const duration = Number(log.duration ?? 0);
  if (duration <= 0) return 0;
  return round(duration * inferCardioIntensityFactor(log, sets, tags, athlete), 1);
}
