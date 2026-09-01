import {
  EXERCISE_DEFINITIONS,
  type ExerciseLoadTag,
  type HrZone,
  type HrZoneBoundary,
  type InsertExerciseSet,
  type LoadGovernorAcwrZone,
  type LoadGovernorVector,
  normalizeExerciseName,
  type TrainingLoadOverview,
  type TrainingLoadRestriction,
  type TrainingMonotonyZone,
  type WorkoutLog,
  type WorkoutSuggestion,
} from "@shared/schema";
import { addDaysToISODate as addDays, dayDiff as daysBetween, toIsoDateUtc } from "@shared/dateUtils";
import { storedWeightToKg } from "@shared/unitConversion";

export type LoadVector = LoadGovernorVector;

export const LOAD_VECTOR_KEYS = [
  "posterior_chain",
  "anterior_chain",
  "unilateral_stability",
  "elastic_tendon",
] as const satisfies readonly LoadVector[];

const TREND_DAYS = 42;
const ABSOLUTE_VECTOR_LOAD_THRESHOLD = 45;
const ELASTIC_SEVEN_DAY_THRESHOLD = 80;

export interface ExerciseLoadTagInput {
  exerciseName: string;
  posteriorChain: number;
  anteriorChain: number;
  unilateralStability: number;
  elasticTendon: number;
  axialLoadModifier: number;
  tendonLoadModifier: number;
  eccentricRiskModifier: number;
  highIntensityRunningRisk: number;
}

type ExerciseLoadTagValues = readonly [
  posteriorChain: number,
  anteriorChain: number,
  unilateralStability: number,
  elasticTendon: number,
  axialLoadModifier: number,
  tendonLoadModifier: number,
  eccentricRiskModifier: number,
  highIntensityRunningRisk: number,
];

export type TrainingLoadSet = {
  id?: string;
  workoutLogId: string;
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  setNumber?: number | null;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
  plannedReps?: number | null;
  plannedWeight?: number | null;
  plannedDistance?: number | null;
  plannedTime?: number | null;
  /**
   * The units this row's numbers are actually in (audit L4). Present on every
   * row written since the unit stamp; absent on legacy rows, which fall back to
   * the athlete's current preference exactly as before.
   */
  weightUnit?: string | null;
  distanceUnit?: string | null;
};

export interface PromptExerciseForLoad {
  exerciseName: string;
  customLabel?: string | null;
  category?: string | null;
  setNumber?: number | null;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
  notes?: string | null;
  sortOrder?: number | null;
}

export interface UpcomingWorkoutForLoad {
  id: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory?: string;
  notes?: string;
  exerciseDetails?: PromptExerciseForLoad[];
}

export interface LoadGovernorSuggestion {
  suggestion: WorkoutSuggestion;
  structuredSetRows?: InsertExerciseSet[];
  rationaleCode: string;
  // New workout title for the converted day. Only the governor supplies this
  // (it knows it is downshifting to a recovery run), so the AI-provider path
  // never renames a workout's title.
  focusOverride?: string;
}

export interface DailyTrainingLoad {
  date: string;
  strengthStressScore: number;
  cardioStressScore: number;
  utss: number;
  acwr: number | null;
  zone: LoadGovernorAcwrZone;
  vectorLoads: Record<LoadVector, number>;
  // EWMA fitness/fatigue (exponentially weighted UTSS). acuteEwma ≈ 7-day
  // fatigue, chronicEwma ≈ 28-day fitness; both null before firstLogDate.
  acuteEwma: number | null;
  chronicEwma: number | null;
  // Training Stress Balance / "Form" = chronicEwma − acuteEwma. Positive ⇒
  // fresh/rested, negative ⇒ fatigued. Null until the EWMAs are seeded.
  tsb: number | null;
  // Foster monotony (mean ÷ population SD of the trailing 7-day UTSS) and strain
  // (weekly UTSS × monotony). Null only when the week carried no load at all, or
  // before the athlete has 7 days of history; uniform load reports at the
  // MONOTONY_CEILING rather than as null.
  monotony: number | null;
  strain: number | null;
  // Display-only objective load, accumulated in parallel to UTSS — never feeds
  // UTSS, so the governor stays calibrated. hrTSS (HR, 100-pt scale) and power
  // TSS (estimated from avg power); hrZone = the day's most intense HR session.
  hrTss: number | null;
  hrZone: HrZone | null;
  tss: number | null;
}

export interface TrainingLoadComputation {
  dailyLoads: DailyTrainingLoad[];
  overview: TrainingLoadOverview;
}

// Minimal physiological context for objective (HR/power) load. All optional —
// when a field is absent we fall back to age-based estimates (Tanaka max HR,
// default resting HR) or, failing that, to the RPE/keyword cardio path.
export interface AthleteLoadContext {
  age?: number | null;
  gender?: string | null;
  restingHr?: number | null;
  maxHr?: number | null;
  ftp?: number | null;
  /** Canonical kg. Scales the tonnage of unweighted reps — see BODYWEIGHT_REP_REFERENCE_KG. */
  bodyweightKg?: number | null;
}

export const DEFAULT_EXERCISE_LOAD_TAGS: ExerciseLoadTagInput[] = [
  tag("deadlift", [1, 0.2, 0.2, 0.1, 1.5, 1, 1.2, 0]),
  tag("sumo_deadlift", [1, 0.25, 0.2, 0.1, 1.45, 1, 1.15, 0]),
  tag("stiff_leg_deadlift", [1, 0.1, 0.3, 0.15, 1.35, 1.1, 1.2, 0]),
  tag("romanian_deadlift", [1, 0.1, 0.25, 0.15, 1.35, 1.1, 1.2, 0]),
  tag("good_morning", [1, 0.1, 0.2, 0.1, 1.45, 1, 1.25, 0]),
  tag("single_leg_rdl", [0.85, 0.15, 0.9, 0.2, 1.15, 1.1, 1.15, 0]),
  tag("hip_thrust", [0.8, 0.1, 0.1, 0.1, 1.05, 1, 1, 0]),
  tag("kettlebell_swings", [0.85, 0.05, 0.2, 0.25, 1.05, 1.05, 1.1, 0]),
  tag("back_extension", [0.75, 0, 0.1, 0.1, 1, 1, 1.05, 0]),
  tag("back_squat", [0.35, 1, 0.2, 0.1, 1.4, 1, 1.2, 0]),
  tag("front_squat", [0.25, 1, 0.2, 0.1, 1.35, 1, 1.15, 0]),
  tag("leg_press", [0.2, 1, 0.1, 0.1, 0.8, 1, 1.1, 0]),
  tag("hack_squat", [0.2, 1, 0.15, 0.1, 1.05, 1, 1.1, 0]),
  tag("lunges", [0.35, 0.95, 0.9, 0.15, 1.1, 1, 1.2, 0]),
  tag("reverse_lunge", [0.35, 0.85, 0.9, 0.15, 1.05, 1, 1.15, 0]),
  tag("walking_lunges", [0.35, 0.95, 0.9, 0.2, 1.05, 1, 1.2, 0]),
  tag("bulgarian_split_squat", [0.35, 0.9, 1, 0.15, 1.1, 1, 1.15, 0]),
  tag("sled_push", [0.45, 0.95, 0.35, 0.25, 1.2, 1.1, 1.1, 0]),
  tag("sandbag_lunges", [0.35, 1, 0.8, 0.2, 1.15, 1, 1.2, 0]),
  tag("wall_balls", [0.2, 0.85, 0.2, 0.25, 0.9, 1.05, 1.1, 0]),
  tag("box_jumps", [0.25, 0.75, 0.7, 1, 0.6, 1.5, 1.25, 0.6]),
  tag("burpee_broad_jump", [0.55, 0.65, 0.8, 0.9, 0.7, 1.35, 1.2, 0.5]),
  tag("jump_rope", [0.1, 0.2, 0.2, 1, 0.5, 1.45, 1, 0.4]),
  tag("calf_raise", [0.05, 0.1, 0.15, 0.9, 0.8, 1.35, 1, 0]),
  tag("standing_calf_raise", [0.05, 0.1, 0.15, 0.9, 0.8, 1.35, 1, 0]),
  tag("seated_calf_raise", [0.05, 0.1, 0.15, 0.8, 0.75, 1.25, 1, 0]),
  tag("run_1k", [0.35, 0.45, 0.2, 0.45, 0.4, 1.15, 1.05, 0.45]),
  tag("easy_run", [0.2, 0.3, 0.1, 0.25, 0.35, 1, 1, 0.1]),
  tag("recovery_run", [0.15, 0.25, 0.1, 0.2, 0.3, 0.9, 0.9, 0]),
  tag("tempo_run", [0.45, 0.5, 0.2, 0.55, 0.45, 1.2, 1.05, 0.75]),
  tag("interval_run", [0.7, 0.55, 0.25, 0.85, 0.5, 1.45, 1.05, 1]),
  tag("hill_repeats", [0.85, 0.55, 0.35, 0.8, 0.55, 1.45, 1.1, 1]),
  tag("fartlek_run", [0.45, 0.45, 0.2, 0.55, 0.45, 1.2, 1, 0.65]),
  tag("long_run", [0.35, 0.65, 0.15, 0.5, 0.4, 1.15, 1.25, 0.25]),
  tag("treadmill_run", [0.25, 0.35, 0.1, 0.35, 0.35, 1.05, 1, 0.25]),
  tag("sprints", [0.8, 0.55, 0.35, 0.9, 0.55, 1.5, 1.1, 1]),
  tag("treadmill_intervals", [0.65, 0.5, 0.2, 0.75, 0.45, 1.35, 1, 0.9]),
  tag("incline_walk", [0.65, 0.45, 0.2, 0.35, 0.35, 1.15, 1, 0.45]),
  tag("stair_climber", [0.45, 0.85, 0.25, 0.35, 0.45, 1.15, 1.1, 0.35]),
];

function tag(exerciseName: string, values: ExerciseLoadTagValues): ExerciseLoadTagInput {
  const [
    posteriorChain,
    anteriorChain,
    unilateralStability,
    elasticTendon,
    axialLoadModifier,
    tendonLoadModifier,
    eccentricRiskModifier,
    highIntensityRunningRisk,
  ] = values;

  return {
    exerciseName,
    posteriorChain,
    anteriorChain,
    unilateralStability,
    elasticTendon,
    axialLoadModifier,
    tendonLoadModifier,
    eccentricRiskModifier,
    highIntensityRunningRisk,
  };
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyVectorLoads(): Record<LoadVector, number> {
  return {
    posterior_chain: 0,
    anterior_chain: 0,
    unilateral_stability: 0,
    elastic_tendon: 0,
  };
}

function normalizeTags(
  tags: readonly ExerciseLoadTagInput[] | readonly ExerciseLoadTag[],
): Map<string, ExerciseLoadTagInput> {
  const map = new Map<string, ExerciseLoadTagInput>();
  for (const tag of DEFAULT_EXERCISE_LOAD_TAGS) map.set(tag.exerciseName, tag);
  for (const tag of tags) {
    map.set(tag.exerciseName, {
      exerciseName: tag.exerciseName,
      posteriorChain: Number(tag.posteriorChain ?? 0),
      anteriorChain: Number(tag.anteriorChain ?? 0),
      unilateralStability: Number(tag.unilateralStability ?? 0),
      elasticTendon: Number(tag.elasticTendon ?? 0),
      axialLoadModifier: Number(tag.axialLoadModifier ?? 1),
      tendonLoadModifier: Number(tag.tendonLoadModifier ?? 1),
      eccentricRiskModifier: Number(tag.eccentricRiskModifier ?? 1),
      highIntensityRunningRisk: Number(tag.highIntensityRunningRisk ?? 0),
    });
  }
  return map;
}

function inferTag(exerciseName: string, category?: string | null): ExerciseLoadTagInput {
  const definition = EXERCISE_DEFINITIONS[exerciseName as keyof typeof EXERCISE_DEFINITIONS];
  const groups = definition?.muscleGroups ?? [];
  const lowerGroups = groups.map((group) => group.toLowerCase());
  const cat = category ?? definition?.category ?? "conditioning";
  const posterior = lowerGroups.some((g) => /hamstrings|glutes|back|lower back/.test(g)) ? 0.45 : 0;
  const anterior = lowerGroups.some((g) => /quads|legs/.test(g)) ? 0.45 : 0;
  const elastic = lowerGroups.some((g) => /calves|ankles|cardio/.test(g)) ? 0.25 : 0;
  const running = cat === "running";
  return tag(exerciseName, [
    running ? Math.max(posterior, 0.2) : posterior,
    running ? Math.max(anterior, 0.25) : anterior,
    0.1,
    running ? Math.max(elastic, 0.25) : elastic,
    cat === "strength" ? 1 : 0.7,
    1,
    running ? 1.05 : 1,
    running ? 0.25 : 0,
  ]);
}

function getTag(
  tags: Map<string, ExerciseLoadTagInput>,
  exerciseName: string,
  category?: string | null,
): ExerciseLoadTagInput {
  return tags.get(exerciseName) ?? inferTag(exerciseName, category);
}

function isStrengthSet(set: TrainingLoadSet): boolean {
  const reps = Number(set.reps ?? set.plannedReps ?? 0);
  const weight = Number(set.weight ?? set.plannedWeight ?? 0);
  return (
    set.category === "strength" ||
    (reps > 0 && weight > 0) ||
    (reps > 0 && (set.category === "conditioning" || set.category === "functional"))
  );
}

function isCardioSet(set: TrainingLoadSet): boolean {
  return (
    set.category === "running" ||
    set.category === "conditioning" ||
    Number(set.distance ?? set.plannedDistance ?? 0) > 0
  );
}

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
  >,
  tag: ExerciseLoadTagInput,
  rpe?: number | null,
  weightUnit: string = "kg",
  /** Canonical kg, for scaling unweighted reps (audit M2). */
  athleteBodyweightKg?: number | null,
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
  const distance = Number(set.distance ?? set.plannedDistance ?? 0);
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

function inferWorkoutText(
  log: Pick<WorkoutLog, "focus" | "mainWorkout" | "accessory" | "notes">,
): string {
  return [log.focus, log.mainWorkout, log.accessory ?? "", log.notes ?? ""].join(" ").toLowerCase();
}

// ── Objective cardio load (heart rate / power) ───────────────────────────────
// When a workout carries HR or power data we derive the cardio intensity factor
// from that objective signal instead of RPE/keywords. The factor stays in the
// SAME 0.6–2.6 band the RPE branch produces (RPE uses 0.6 + (rpe/10)²·2), so
// UTSS magnitudes — and every governor threshold calibrated to them — keep the
// same scale. hrTSS / power TSS are computed separately for display only
// (hrTss / powerTss) and never feed UTSS.
const DEFAULT_HR_REST = 60;
const DEFAULT_HR_MAX = 190;
const MAX_CARDIO_INTENSITY_FACTOR = 2.6;

// Tanaka 2001 age-predicted max HR, falling back to a flat default when age is
// unknown.
export function estimateHrMax(age?: number | null): number {
  return age && age > 0 ? Math.round(208 - 0.7 * age) : DEFAULT_HR_MAX;
}

/**
 * The athlete's max HR and where it came from.
 *
 * `DEFAULT_HR_MAX` (190) is the Tanaka prediction for a 26-year-old. Applying
 * it to an athlete whose age we do not know is not a small approximation: a
 * 52-year-old's predicted max is 172, so their threshold run scored 69.2% of
 * heart-rate reserve instead of the true 82.3% and was classified as easy
 * aerobic Z2 (audit H3). `users.age` is only ever written by the OPTIONAL
 * nutrition onboarding step, so skipping a nutrition screen silently corrupted
 * every heart-rate-derived number.
 */
function resolveHrMax(athlete?: AthleteLoadContext): {
  hrMax: number;
  basis: "measured" | "age_estimated" | "assumed";
} {
  if (athlete?.maxHr && athlete.maxHr > 0) return { hrMax: athlete.maxHr, basis: "measured" };
  if (athlete?.age && athlete.age > 0) {
    return { hrMax: estimateHrMax(athlete.age), basis: "age_estimated" };
  }
  return { hrMax: DEFAULT_HR_MAX, basis: "assumed" };
}

function resolveHrRest(athlete?: AthleteLoadContext): number {
  return athlete?.restingHr && athlete.restingHr > 0 ? athlete.restingHr : DEFAULT_HR_REST;
}

// Karvonen heart-rate reserve fraction in (0,1], or null when the inputs can't
// produce a meaningful value (no/low HR, max ≤ rest, or avg ≤ rest).
export function hrReserveRatio(
  avgHr: number | null | undefined,
  athlete?: AthleteLoadContext,
): number | null {
  const hr = Number(avgHr ?? 0);
  if (hr <= 0) return null;
  const hrRest = resolveHrRest(athlete);
  const { hrMax, basis } = resolveHrMax(athlete);
  // With neither a measured max nor an age there is no honest denominator, so
  // the HR signal is WITHHELD rather than computed against a 26-year-old's
  // predicted max (audit H3). Callers fall through to the RPE the athlete
  // actually gave, which is a real observation rather than a guess.
  if (basis === "assumed") return null;
  if (hrMax <= hrRest) return null;
  const ratio = (hr - hrRest) / (hrMax - hrRest);
  if (ratio <= 0) return null;
  return Math.min(1, ratio);
}

// Map a normalized cardio intensity (HR-reserve fraction or power %FTP) into the
// app's 0.6–2.6 band using the same quadratic shape as the RPE branch, so easy
// aerobic work scores low and threshold/max work approaches the ceiling.
function intensityFactorFromFraction(fraction: number): number {
  const f = Math.max(0, fraction);
  return round(Math.min(MAX_CARDIO_INTENSITY_FACTOR, 0.6 + f * f * 2), 2);
}

export function hrIntensityFactor(hrr: number): number {
  return intensityFactorFromFraction(hrr);
}

// Power-based intensity factor from %FTP (avgWatts / FTP). Null without usable
// FTP + watts. Above-threshold efforts clamp at the band ceiling.
export function powerIntensityFactor(
  avgWatts: number | null | undefined,
  ftp: number | null | undefined,
): number | null {
  const watts = Number(avgWatts ?? 0);
  const threshold = Number(ftp ?? 0);
  if (watts <= 0 || threshold <= 0) return null;
  return intensityFactorFromFraction(watts / threshold);
}

// ── HR zones, LTHR & hrTSS (display-only objective load) ─────────────────────
// Zones use the SAME Karvonen HRR axis as hrReserveRatio / hrIntensityFactor, so
// the zone label, intensity factor and hrTSS stay mutually consistent. With only
// average HR we classify a session into a SINGLE zone (NOT time-in-zone) and
// derive an hrTSS on the 100-pt TSS scale anchored on an estimated LTHR.

// Karvonen %HRR lower bounds for Z1..Z5.
const HR_ZONE_FLOORS = [0, 0.6, 0.7, 0.8, 0.9] as const;
const HR_ZONES: readonly HrZone[] = ["z1", "z2", "z3", "z4", "z5"];

function hrZoneRank(zone: HrZone): number {
  return HR_ZONES.indexOf(zone);
}

// Estimated lactate-threshold HR. No schema field — derived from (estimated) max
// HR at ~88% HRmax, the common no-field-test heuristic. Floored strictly above
// resting HR so the hrTSS denominator (LTHR − rest) is always positive.
export function estimateLthr(athlete?: AthleteLoadContext): number {
  const { hrMax } = resolveHrMax(athlete);
  const hrRest = resolveHrRest(athlete);
  return Math.max(Math.round(0.88 * hrMax), hrRest + 1);
}

// bpm boundaries for the five Karvonen %HRR zones from resolved rest/max HR.
// Z1.minHr == resting HR, Z5.maxHr == max HR.
export function hrZoneBoundaries(athlete?: AthleteLoadContext): HrZoneBoundary[] {
  const hrRest = resolveHrRest(athlete);
  const { hrMax, basis } = resolveHrMax(athlete);
  // No measured max and no age means no honest zone table. Rendering one built
  // on a 26-year-old's predicted max told a 52-year-old their threshold effort
  // was easy aerobic work (audit H3); an empty table shows nothing instead.
  if (basis === "assumed") return [];
  // Same guard `hrReserveRatio` already applies. Without it, a resting HR entered
  // above max produced a negative reserve and an inverted zone table rendered as
  // fact; an empty table correctly shows nothing instead (audit L8).
  if (hrMax <= hrRest) return [];
  const reserve = hrMax - hrRest;
  return HR_ZONES.map((zone, i) => {
    const minHrr = HR_ZONE_FLOORS[i];
    const maxHrr = i < HR_ZONE_FLOORS.length - 1 ? HR_ZONE_FLOORS[i + 1] : 1;
    return {
      zone,
      minHrr,
      minHr: Math.round(hrRest + minHrr * reserve),
      maxHr: Math.round(hrRest + maxHrr * reserve),
    };
  });
}

// Single per-session Karvonen %HRR zone from average HR — NOT time-in-zone
// (averages only). Null when HR is unusable (same guards as hrReserveRatio).
export function classifyHrZone(
  avgHr: number | null | undefined,
  athlete?: AthleteLoadContext,
): HrZone | null {
  const hrr = hrReserveRatio(avgHr, athlete);
  if (hrr == null) return null;
  if (hrr < 0.6) return "z1";
  if (hrr < 0.7) return "z2";
  if (hrr < 0.8) return "z3";
  if (hrr < 0.9) return "z4";
  return "z5";
}

// hrTSS — display-only objective internal load on the 100-pt TSS scale, parallel
// to powerTss (NOT added to UTSS). IF_hr is the LTHR-reserve fraction clamped to
// [0,1]; IF_hr = 1.0 exactly when avgHr == LTHR. Average HR above threshold caps
// at 1.0 — a deliberate averages-only choice. Null without usable HR + duration.
export function hrTss(
  durationMin: number | null | undefined,
  avgHr: number | null | undefined,
  athlete?: AthleteLoadContext,
): number | null {
  const duration = Number(durationMin ?? 0);
  const hr = Number(avgHr ?? 0);
  if (duration <= 0 || hr <= 0) return null;
  const hrRest = resolveHrRest(athlete);
  const lthr = estimateLthr(athlete);
  if (lthr <= hrRest) return null;
  const intensity = Math.max(0, Math.min(1, (hr - hrRest) / (lthr - hrRest)));
  if (intensity <= 0) return null;
  return round((duration / 60) * intensity * intensity * 100, 1);
}

// Simplified power TSS — display-only (NOT added to UTSS). With only average
// power available, normalized power ≈ avgWatts, so
// TSS ≈ (minutes/60) · (avgWatts/FTP)² · 100. Null without FTP + watts.
export function powerTss(
  durationMin: number | null | undefined,
  avgWatts: number | null | undefined,
  ftp: number | null | undefined,
): number | null {
  const duration = Number(durationMin ?? 0);
  const watts = Number(avgWatts ?? 0);
  const threshold = Number(ftp ?? 0);
  if (duration <= 0 || watts <= 0 || threshold <= 0) return null;
  const intensity = watts / threshold;
  return round((duration / 60) * intensity * intensity * 100, 1);
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

function updateVectorLoads(
  vectorLoads: Record<LoadVector, number>,
  stress: number,
  tag: ExerciseLoadTagInput,
  cardioScale = 1,
): void {
  vectorLoads.posterior_chain += stress * tag.posteriorChain * cardioScale;
  vectorLoads.anterior_chain += stress * tag.anteriorChain * cardioScale;
  vectorLoads.unilateral_stability += stress * tag.unilateralStability * cardioScale;
  vectorLoads.elastic_tendon +=
    stress * tag.elasticTendon * Math.max(1, tag.tendonLoadModifier) * cardioScale;
}

function getOrCreateDay(map: Map<string, DailyTrainingLoad>, date: string): DailyTrainingLoad {
  let day = map.get(date);
  if (!day) {
    day = {
      date,
      strengthStressScore: 0,
      cardioStressScore: 0,
      utss: 0,
      acwr: null,
      zone: "insufficient_data",
      vectorLoads: emptyVectorLoads(),
      acuteEwma: null,
      chronicEwma: null,
      tsb: null,
      monotony: null,
      strain: null,
      hrTss: null,
      hrZone: null,
      tss: null,
    };
    map.set(date, day);
  }
  return day;
}

function buildSetMap(sets: readonly TrainingLoadSet[]): Map<string, TrainingLoadSet[]> {
  const map = new Map<string, TrainingLoadSet[]>();
  for (const set of sets) {
    const existing = map.get(set.workoutLogId) ?? [];
    existing.push(set);
    map.set(set.workoutLogId, existing);
  }
  return map;
}

function dateRange(start: string, end: string): string[] {
  const result: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    result.push(date);
  }
  return result;
}

// EWMA decay constants. λ = 2/(N+1) gives an exponential moving average whose
// centre of mass matches the old N-day rolling window: N=7 for acute fatigue,
// N=28 for chronic fitness. EWMA decays load exponentially instead of dropping
// it off a cliff when a big day leaves a fixed window (Williams 2017).
const ACUTE_LAMBDA = 2 / (7 + 1); // 0.25
const CHRONIC_LAMBDA = 2 / (28 + 1); // ≈ 0.069

/**
 * Logged history the EWMAs need behind them before their values mean what their
 * names say.
 *
 * Both are seeded at the first log the CALLER passed, so a short fetch window
 * silently reseeds them: the nutrition recovery path fetched 7 days and read a
 * "28-day chronic baseline" off the result. For an athlete tapering after eight
 * heavy weeks that reported 26.1 against a true 107.2 — a 4x understatement of
 * the baseline their fuelling targets are scaled from, at exactly the moment
 * fuelling matters most (audit H21).
 *
 * Two chronic windows. The seed's weight decays as (1 - CHRONIC_LAMBDA)^n, so it
 * still carries ~13% at 28 days and under 2% at 56 — the point where the answer
 * stops depending on where the caller happened to start looking.
 */
export const EWMA_WARMUP_DAYS = 56;

// Foster monotony classification. Monotony > 2.0 is a well-known overtraining /
// illness predictor; 1.5–2.0 is an early-warning band.
export function monotonyZone(monotony: number | null): TrainingMonotonyZone {
  if (monotony == null) return "unknown";
  if (monotony > 2) return "high_risk";
  if (monotony >= 1.5) return "elevated";
  return "ok";
}

// Monotony diverges as the week's load flattens (mean ÷ SD → ∞ at SD = 0), so it
// is reported at this ceiling instead. 5× the 2.0 high-risk threshold: far enough
// above the band to be unambiguous, small enough to render and to keep strain
// (weekly load × monotony) on a human scale.
const MONOTONY_CEILING = 10;

// Foster monotony (mean ÷ population SD of the trailing 7 days of UTSS) and
// strain (weekly UTSS × monotony).
//
// UNRESOLVED (audit M26): this uses POPULATION SD (÷n). The stated reason used to
// be that it "keeps a single hard day in an otherwise-easy week finite", and that
// reason is simply wrong — both conventions are finite for any week that is not
// perfectly flat, and the SD = 0 case below is what actually handles flatness.
// The real consequence is that ÷n instead of ÷(n−1) makes SD smaller and so
// monotony uniformly larger, by sqrt(7/6) = 8.0%, measured against a 2.0
// threshold taken from Foster's literature. Whether that threshold assumes the
// sample SD could not be established from primary sources here, and switching
// would move every athlete's monotony zone, so it is left as-is and flagged
// rather than changed on a guess.
//
// SD = 0 arises from two situations that mean OPPOSITE things, and conflating
// them is what made this metric silent for the athletes it exists to protect:
//   - every day zero (no training): mean is 0 too, so monotony is 0/0 — genuinely
//     undefined. Reported as null → zone "unknown".
//   - every day identical and non-zero: monotony is unbounded. That is the single
//     strongest overtraining pattern Foster's metric detects, so it is reported at
//     MONOTONY_CEILING → zone "high_risk".
//
// Variance is two-pass on purpose. The one-pass `sumSq/n − mean²` form cancels
// catastrophically once the week's values are identical or near-identical, and
// which way it lands depends on the magnitude of the values: 66 UTSS/day cancelled
// to exactly 0 (silently "ok"), while 94.8 UTSS/day — a 60-minute RPE-7 session —
// left a ~1.3e-6 residue and scored monotony 70,289,952.98 against a threshold of
// 2.0. Same training pattern, two absurd answers, chosen by a float bit pattern.
function computeMonotonyStrain(
  days: Map<string, DailyTrainingLoad>,
  endDate: string,
  /** First date whose trailing 7-day window lies wholly inside the athlete's history. */
  availableFrom: string | null,
): { monotony: number | null; strain: number | null } {
  if (availableFrom == null || endDate < availableFrom) return { monotony: null, strain: null };

  // The window is collected once into `values` and read twice (mean, then squared
  // deviations). The array is what makes the two-pass variance above possible; on
  // a fixed 7-element window its allocation cost is not worth trading for the
  // one-pass form's cancellation.
  const count = 7;
  const values: number[] = [];
  let total = 0;
  for (let offset = 0; offset < count; offset++) {
    const v = days.get(addDays(endDate, -offset))?.utss ?? 0;
    values.push(v);
    total += v;
  }
  const mean = total / count;
  // No load at all this week: monotony is undefined, not low and not high.
  if (mean === 0) return { monotony: null, strain: null };

  // SAMPLE standard deviation, / (n - 1), matching the convention Foster's 2.0
  // threshold was derived under (audit M26).
  //
  // This used to divide by n. The comment justifying that claimed it kept "a
  // single hard day in an otherwise-easy week finite", which is not true —
  // both conventions are finite for any week that is not perfectly flat, and
  // the sd === 0 branch below is what actually handles flatness.
  //
  // The convention is not cosmetic, because monotony is read against an
  // absolute threshold taken from the literature. Foster's 1998 threshold was
  // established with the statistical tooling of the time — SPSS and Excel's
  // STDEV — both of which default to the sample equation; and sports-science
  // methodology treats a 7-day microcycle as a SAMPLE of the athlete's ongoing
  // macrocycle, not a closed population. Dividing by n made sd smaller and
  // monotony correspondingly larger: every score ran 8.01% above what the 2.0
  // threshold was calibrated for, so an athlete whose true monotony was 1.85
  // read 2.00 and was flagged for overtraining.
  //
  // Correcting it moves every athlete's score DOWN by 7.42% (the reciprocal of
  // the same sqrt(7/6) ratio). The window is gated to exactly 7 whole days by
  // `availableFrom`, so the n - 1 denominator is always 6 and never zero.
  let sumSquaredDeviation = 0;
  for (const v of values) sumSquaredDeviation += (v - mean) * (v - mean);
  const sd = Math.sqrt(Math.max(0, sumSquaredDeviation / (count - 1)));

  const monotony = sd === 0 ? MONOTONY_CEILING : Math.min(round(mean / sd, 2), MONOTONY_CEILING);
  return { monotony, strain: round(total * monotony, 1) };
}

export function resolveAcwrZone(acwr: number | null, chronicAvg: number): LoadGovernorAcwrZone {
  if (acwr == null || chronicAvg <= 0) return "insufficient_data";
  if (acwr < 0.8) return "undertraining";
  if (acwr <= 1.3) return "sweet_spot";
  if (acwr <= 1.5) return "yellow";
  return "danger";
}

// ACWR needs a real chronic baseline before the ratio means anything, so the
// ratio is gated behind ~2 weeks of logged history (ACWR_MIN_HISTORY_DAYS). The
// EWMAs are SEEDED at firstLogDate with that day's UTSS (not zero) and advanced
// day-by-day across the whole range, including rest days. Seeding at the first
// real day — instead of letting pre-history zeros bleed into the average — is the
// EWMA-native replacement for the old coverage-adjusted chronic denominator: it
// stops a brand-new athlete's empty pre-history from deflating the baseline and
// inflating ACWR (e.g. 18 steady days read ≈1.0, not "danger").
const ACWR_MIN_HISTORY_DAYS = 14;

// Monotony reads a trailing 7-day window and treats absent days as rest, so it
// needs the whole window to lie inside the athlete's own history. Until then an
// athlete was handed a monotony and a strain computed almost entirely from days
// that predate them — one logged workout scored monotony 0.41 (audit M9). This
// is deliberately its own gate: monotony needs 7 days, not ACWR's 14.
const MONOTONY_WINDOW_DAYS = 7;

// Single forward pass: maintain running acute/chronic EWMAs and derive ACWR,
// zone, TSB (chronic − acute, "Form"), and Foster monotony/strain for each day.
function applyLoadDynamics(
  days: Map<string, DailyTrainingLoad>,
  start: string,
  end: string,
  firstLogDate: string | null,
): void {
  const ratioFrom = firstLogDate ? addDays(firstLogDate, ACWR_MIN_HISTORY_DAYS - 1) : null;
  const monotonyFrom = firstLogDate ? addDays(firstLogDate, MONOTONY_WINDOW_DAYS - 1) : null;
  let acute: number | null = null;
  let chronic: number | null = null;

  for (const date of dateRange(start, end)) {
    const day = getOrCreateDay(days, date);

    // Pre-history: no baseline to seed from yet.
    if (firstLogDate == null || date < firstLogDate) {
      day.acwr = null;
      day.zone = "insufficient_data";
      day.acuteEwma = null;
      day.chronicEwma = null;
      day.tsb = null;
      day.monotony = null;
      day.strain = null;
      continue;
    }

    if (acute == null || chronic == null) {
      // Seed both EWMAs with the first logged day's UTSS so the baseline is the
      // athlete's real first-day load, not zero.
      acute = day.utss;
      chronic = day.utss;
    } else {
      acute = ACUTE_LAMBDA * day.utss + (1 - ACUTE_LAMBDA) * acute;
      chronic = CHRONIC_LAMBDA * day.utss + (1 - CHRONIC_LAMBDA) * chronic;
    }
    day.acuteEwma = round(acute, 1);
    day.chronicEwma = round(chronic, 1);

    const { monotony, strain } = computeMonotonyStrain(days, date, monotonyFrom);
    day.monotony = monotony;
    day.strain = strain;

    // TSB ("Form") is gated by the SAME history requirement as ACWR. It used to
    // be assigned above this check, so it was non-null from the athlete's very
    // first logged day — and because chronic decays far slower than acute, any
    // gap produces a large positive Form that reads as "peaked". One workout was
    // enough to be told you were sharp for race day (audit C3).
    if (ratioFrom == null || date < ratioFrom) {
      day.acwr = null;
      day.zone = "insufficient_data";
      day.tsb = null;
      continue;
    }
    day.tsb = round(chronic - acute, 1);
    const acwr = chronic > 0 ? round(acute / chronic, 2) : null;
    day.acwr = acwr;
    day.zone = resolveAcwrZone(acwr, chronic);
  }
}

function maxPriorVectorLoad(
  allDays: Map<string, DailyTrainingLoad>,
  currentDate: string,
  vector: LoadVector,
): number {
  let max = 0;
  for (let offset = 1; offset <= 28; offset++) {
    max = Math.max(max, allDays.get(addDays(currentDate, -offset))?.vectorLoads[vector] ?? 0);
  }
  return max;
}

function isHighVectorDay(
  day: DailyTrainingLoad,
  allDays: Map<string, DailyTrainingLoad>,
  currentDate: string,
  vector: LoadVector,
): boolean {
  const value = day.vectorLoads[vector];
  const priorMax = maxPriorVectorLoad(allDays, currentDate, vector);
  return (
    value >= ABSOLUTE_VECTOR_LOAD_THRESHOLD ||
    (priorMax >= ABSOLUTE_VECTOR_LOAD_THRESHOLD && value >= priorMax * 0.9)
  );
}

function findRecentHighVector(
  allDays: Map<string, DailyTrainingLoad>,
  currentDate: string,
  vector: LoadVector,
  lookbackDays: number,
): DailyTrainingLoad | null {
  for (let offset = 0; offset <= lookbackDays; offset++) {
    const day = allDays.get(addDays(currentDate, -offset));
    if (day && isHighVectorDay(day, allDays, currentDate, vector)) return day;
  }
  return null;
}

function sevenDayVectorTotal(
  allDays: Map<string, DailyTrainingLoad>,
  currentDate: string,
  vector: LoadVector,
): number {
  let total = 0;
  for (let offset = 0; offset < 7; offset++) {
    total += allDays.get(addDays(currentDate, -offset))?.vectorLoads[vector] ?? 0;
  }
  return total;
}

function restriction(
  id: string,
  label: string,
  severity: TrainingLoadRestriction["severity"],
  expiresOn: string | null,
  rationale: string,
  vector?: LoadVector,
): TrainingLoadRestriction {
  return { id, label, severity, expiresOn, rationale, ...(vector ? { vector } : {}) };
}

function buildRestrictions(
  allDays: Map<string, DailyTrainingLoad>,
  currentDate: string,
  currentZone: LoadGovernorAcwrZone,
): TrainingLoadRestriction[] {
  const restrictions: TrainingLoadRestriction[] = [];
  const posterior = findRecentHighVector(allDays, currentDate, "posterior_chain", 1);
  if (posterior) {
    restrictions.push(
      restriction(
        "posterior_chain_velocity_lock",
        "Posterior chain velocity lock",
        "danger",
        addDays(posterior.date, 2),
        "Recent hamstring/glute/back load conflicts with hills, sprints, and high-velocity running.",
        "posterior_chain",
      ),
    );
  }

  const anterior = findRecentHighVector(allDays, currentDate, "anterior_chain", 2);
  if (anterior) {
    restrictions.push(
      restriction(
        "anterior_chain_braking_guard",
        "Anterior chain braking guard",
        "caution",
        addDays(anterior.date, 3),
        "Recent quad/patellar load conflicts with downhill, long-road, and braking-heavy runs.",
        "anterior_chain",
      ),
    );
  }

  const elasticTotal = sevenDayVectorTotal(allDays, currentDate, "elastic_tendon");
  if (elasticTotal >= ELASTIC_SEVEN_DAY_THRESHOLD) {
    restrictions.push(
      restriction(
        "elastic_tendon_speed_guard",
        "Elastic tendon speed guard",
        "danger",
        addDays(currentDate, 3),
        "Seven-day calf/Achilles/plantar load is high, so speed and plyometric sessions should downshift.",
        "elastic_tendon",
      ),
    );
  }

  if (currentZone === "danger") {
    restrictions.push(
      restriction(
        "acwr_danger_lock",
        "ACWR danger lock",
        "danger",
        addDays(currentDate, 4),
        "Acute UTSS is more than 1.5x the chronic baseline, so high-intensity programming is locked down.",
      ),
    );
  } else if (currentZone === "yellow") {
    restrictions.push(
      restriction(
        "acwr_yellow_guard",
        "ACWR yellow guard",
        "caution",
        addDays(currentDate, 2),
        "Acute UTSS is above the preferred chronic baseline range, so upcoming intensity should be monitored.",
      ),
    );
  } else if (currentZone === "undertraining") {
    restrictions.push(
      restriction(
        "acwr_onramp",
        "ACWR on-ramp",
        "info",
        addDays(currentDate, 3),
        "Recent training load is below the 28-day baseline, so re-entry should ramp before peak loads return.",
      ),
    );
  }

  return restrictions;
}

function buildOverview(
  allDays: Map<string, DailyTrainingLoad>,
  currentDate: string,
  rangeStart: string,
  athlete?: AthleteLoadContext,
): TrainingLoadOverview {
  const currentDay = getOrCreateDay(allDays, currentDate);
  // acuteAvg/chronicAvg are today's EWMA fatigue/fitness. applyLoadDynamics is the
  // single source of truth for the ratio, zone, TSB and monotony (including the
  // new-athlete history guard), so we read them straight off today's record.
  const acuteAvg = round(currentDay.acuteEwma ?? 0, 1);
  const chronicAvg = round(currentDay.chronicEwma ?? 0, 1);
  const acwr = currentDay.acwr;
  const zone = currentDay.zone;
  const activeRestrictions = buildRestrictions(allDays, currentDate, zone);
  const flaggedVectors = [
    ...new Set(activeRestrictions.flatMap((r) => (r.vector ? [r.vector] : []))),
  ];
  const trendStart =
    rangeStart > addDays(currentDate, -(TREND_DAYS - 1))
      ? rangeStart
      : addDays(currentDate, -(TREND_DAYS - 1));
  const trend = dateRange(trendStart, currentDate).map((date) => {
    const day = getOrCreateDay(allDays, date);
    return {
      date,
      utss: round(day.utss, 1),
      acwr: day.acwr,
      zone: day.zone,
      tsb: day.tsb,
      monotony: day.monotony,
      strain: day.strain,
      hrTss: day.hrTss,
      hrZone: day.hrZone,
      tss: day.tss,
      acuteEwma: day.acuteEwma,
      chronicEwma: day.chronicEwma,
    };
  });

  return {
    currentUtss: round(currentDay.utss, 1),
    acuteAvg,
    chronicAvg,
    acwr,
    zone,
    tsb: currentDay.tsb,
    monotony: currentDay.monotony,
    strain: currentDay.strain,
    monotonyZone: monotonyZone(currentDay.monotony),
    hrTss: currentDay.hrTss,
    hrZone: currentDay.hrZone,
    tss: currentDay.tss,
    hrZones: hrZoneBoundaries(athlete),
    estimatedLthr: estimateLthr(athlete),
    powerTssEstimated: true,
    flaggedVectors,
    activeRestrictions,
    downshiftRationale: activeRestrictions[0]?.rationale ?? null,
    trend,
  };
}

function earliestLogDate(workoutLogs: readonly Pick<WorkoutLog, "date">[]): string | null {
  return workoutLogs.reduce<string | null>((earliest, log) => {
    if (!earliest || log.date < earliest) return log.date;
    return earliest;
  }, null);
}

function computeRangeStart(
  workoutLogs: readonly Pick<WorkoutLog, "date">[],
  currentDate: string,
): string {
  const earliestLog = earliestLogDate(workoutLogs);
  const minNeeded = addDays(currentDate, -(TREND_DAYS + 28));
  if (!earliestLog || earliestLog > minNeeded) return minNeeded;
  return earliestLog;
}

// Endurance keywords in a workout's own text. Named because two things key off
// it: whether the duration-based cardio branch runs at all, and — for a workout
// with no sets to read a tag from — which vector profile its load lands on.
const ENDURANCE_TEXT_PATTERN = /run|bike|row|ski|walk|hike/i;

// The impact subset of the above: repeated foot-strike, which is what the
// running vector profile's elastic-tendon weighting is calibrated for.
const FOOT_STRIKE_TEXT_PATTERN = /run|walk|hike/i;

function shouldApplyCardioStress(
  log: Pick<WorkoutLog, "duration" | "focus" | "mainWorkout" | "accessory" | "notes">,
  sets: readonly TrainingLoadSet[],
): boolean {
  return Boolean(
    log.duration &&
    (sets.length === 0 ||
      sets.some(isCardioSet) ||
      ENDURANCE_TEXT_PATTERN.test(inferWorkoutText(log))),
  );
}

/**
 * A load tag for a workout that carries no sets at all — a Strava/Garmin import
 * or a free-text log.
 *
 * Such a workout reaches the cardio branch and moves UTSS, but nothing ever
 * touched its injury vectors, so every vector stayed exactly 0 and all four
 * vector restrictions were inert for every imported session (audit H19). An
 * athlete whose running is all imported could never trip the Achilles guard.
 *
 * The exercise is resolved from the athlete's own focus/summary text through
 * the same normaliser the rest of the app uses; failing that, the endurance
 * keyword the cardio branch already matched on picks the category, so "45 min
 * easy run" loads posterior chain and Achilles the way a logged run does. A
 * workout that names nothing recognisable stays near zero, which is honest —
 * there is nothing to attribute it to.
 */
function inferredWorkoutTag(
  log: Pick<WorkoutLog, "focus" | "mainWorkout" | "accessory" | "notes">,
  tags: Map<string, ExerciseLoadTagInput>,
): ExerciseLoadTagInput {
  for (const text of [log.focus, log.mainWorkout]) {
    const resolved = text ? normalizeExerciseName(text) : null;
    if (resolved) return getTag(tags, resolved, null);
  }
  // Only foot-strike work inherits the running profile, whose elastic-tendon
  // weight and tendon modifier exist for repeated impact. Rowing, skiing and
  // cycling are in ENDURANCE_TEXT_PATTERN because they are duration work, but
  // giving a Zwift ride the same Achilles loading as a run would invent a risk
  // that is not there. They fall through to conditioning, which stays near zero
  // — honest, because the text alone does not say what they loaded.
  const category = FOOT_STRIKE_TEXT_PATTERN.test(inferWorkoutText(log)) ? "running" : "conditioning";
  return inferTag("", category);
}

function applyStrengthLoad(
  day: DailyTrainingLoad,
  log: Pick<WorkoutLog, "rpe">,
  sets: readonly TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput>,
  weightUnit: string,
  athlete?: AthleteLoadContext,
): void {
  for (const set of sets) {
    if (!isStrengthSet(set)) continue;
    const setTag = getTag(tags, set.exerciseName, set.category);
    const stress = calculateStrengthStressScore(set, setTag, log.rpe, weightUnit, athlete?.bodyweightKg);
    day.strengthStressScore += stress;
    updateVectorLoads(day.vectorLoads, stress, setTag);
  }
}

function applyCardioLoad(
  day: DailyTrainingLoad,
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
  sets: readonly TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput>,
  athlete?: AthleteLoadContext,
): void {
  if (!shouldApplyCardioStress(log, sets)) return;

  const stress = calculateCardioStressScore(log, [...sets], tags, athlete);
  day.cardioStressScore += stress;

  // Display-only objective load, accumulated in parallel to UTSS (never feeds it).
  const sessionHrTss = hrTss(log.duration, log.avgHeartrate, athlete);
  if (sessionHrTss != null) day.hrTss = round((day.hrTss ?? 0) + sessionHrTss, 1);
  // Per-day zone = the most intense HR session's zone (ordinal max, z1<…<z5).
  const sessionZone = classifyHrZone(log.avgHeartrate, athlete);
  if (
    sessionZone != null &&
    (day.hrZone == null || hrZoneRank(sessionZone) > hrZoneRank(day.hrZone))
  ) {
    day.hrZone = sessionZone;
  }
  const tss = powerTss(log.duration, log.avgWatts, athlete?.ftp);
  if (tss != null) day.tss = round((day.tss ?? 0) + tss, 1);

  const cardioSets = sets.filter(isCardioSet);
  if (cardioSets.length > 0) {
    // Deliberate stacking: a mixed/circuit set contributes its tonnage to the
    // vectors via the strength path AND a 0.25-damped share of the workout's
    // duration-based cardio stress here — mirroring how UTSS itself sums
    // strength + cardio for the same session. The damping is the calibration;
    // don't "deduplicate" without recalibrating thresholds downstream.
    const stressPerSet = stress / cardioSets.length;
    for (const set of cardioSets) {
      updateVectorLoads(
        day.vectorLoads,
        stressPerSet,
        getTag(tags, set.exerciseName, set.category),
        0.25,
      );
    }
    return;
  }

  // Sets exist but none are cardio: the strength path has already put this
  // session's tonnage on the vectors. Adding workout-level load here would
  // double-count it.
  if (sets.length > 0) return;

  // No sets at all — nothing else will ever touch this workout's vectors
  // (audit H19). Same 0.25 damping as the per-set path above, so this stays on
  // the existing calibration rather than introducing a second scale.
  updateVectorLoads(day.vectorLoads, stress, inferredWorkoutTag(log, tags), 0.25);
}

function finalizeDailyLoad(day: DailyTrainingLoad): void {
  day.strengthStressScore = round(day.strengthStressScore, 1);
  day.cardioStressScore = round(day.cardioStressScore, 1);
  day.utss = round(day.strengthStressScore + day.cardioStressScore, 1);
  for (const key of LOAD_VECTOR_KEYS) day.vectorLoads[key] = round(day.vectorLoads[key], 1);
}

function applyWorkoutLoad(
  day: DailyTrainingLoad,
  log: WorkoutLog,
  sets: readonly TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput>,
  weightUnit: string,
  athlete?: AthleteLoadContext,
): void {
  applyStrengthLoad(day, log, sets, tags, weightUnit, athlete);
  applyCardioLoad(day, log, sets, tags, athlete);
  finalizeDailyLoad(day);
}

export function calculateTrainingLoad(
  workoutLogs: readonly WorkoutLog[],
  exerciseSets: readonly TrainingLoadSet[],
  loadTags: readonly ExerciseLoadTagInput[] | readonly ExerciseLoadTag[] = [],
  options: {
    currentDate?: string;
    weightUnit?: string;
    athlete?: AthleteLoadContext;
    /**
     * The date the caller actually fetched `workoutLogs` from. Supply it and the
     * EWMA-derived values are withheld when the window is too short to support
     * them, rather than reported from a seed the window itself created (H21).
     * Omitted, behaviour is unchanged.
     */
    historyFrom?: string;
  } = {},
): TrainingLoadComputation {
  // Callers should pass the athlete-local date; the UTC day is only a fallback.
  const currentDate = options.currentDate ?? toIsoDateUtc(new Date());
  // Stored weights are in the athlete's display unit; normalize to canonical kg
  // so UTSS represents physiological load. Defaults to kg for callers that don't
  // supply the preference (and for the kg-native majority).
  const weightUnit = options.weightUnit ?? "kg";
  const athlete = options.athlete;
  const rangeStart = computeRangeStart(workoutLogs, currentDate);
  const tags = normalizeTags(loadTags);
  const setsByLog = buildSetMap(exerciseSets);
  const allDays = new Map<string, DailyTrainingLoad>();

  for (const date of dateRange(rangeStart, currentDate)) {
    getOrCreateDay(allDays, date);
  }

  for (const log of workoutLogs) {
    const day = getOrCreateDay(allDays, log.date);
    const sets = setsByLog.get(log.id) ?? [];
    applyWorkoutLoad(day, log, sets, tags, weightUnit, athlete);
  }

  const firstLogDate = earliestLogDate(workoutLogs);
  // A window that starts later than the warmup cannot support the EWMAs no
  // matter what is in it: whatever log lands first becomes the seed for both.
  const truncated =
    options.historyFrom != null &&
    // -(N - 1): a window covering [currentDate - (N-1) .. currentDate] IS N days,
    // so a caller that fetched exactly the warmup must not be called truncated.
    options.historyFrom > addDays(currentDate, -(EWMA_WARMUP_DAYS - 1)) &&
    (firstLogDate == null || firstLogDate >= options.historyFrom);
  applyLoadDynamics(allDays, rangeStart, currentDate, truncated ? null : firstLogDate);

  return {
    // ⚡ Bolt Performance Optimization:
    // Fast string comparison for YYYY-MM-DD dates instead of localeCompare.
    // Avoids unnecessary overhead since ISO dates sort lexicographically.
    dailyLoads: Array.from(allDays.values()).sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    }),
    overview: buildOverview(allDays, currentDate, rangeStart, athlete),
  };
}
