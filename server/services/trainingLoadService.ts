import {
  EXERCISE_DEFINITIONS,
  type ExerciseLoadTag,
  type InsertExerciseSet,
  type LoadGovernorAcwrZone,
  type LoadGovernorVector,
  type TrainingLoadOverview,
  type TrainingLoadRestriction,
  type TrainingMonotonyZone,
  type WorkoutLog,
  type WorkoutSuggestion,
} from "@shared/schema";
import { userWeightToKg } from "@shared/unitConversion";

export type LoadVector = LoadGovernorVector;

export const LOAD_VECTOR_KEYS = [
  "posterior_chain",
  "anterior_chain",
  "unilateral_stability",
  "elastic_tendon",
] as const satisfies readonly LoadVector[];

const DAY_MS = 24 * 60 * 60 * 1000;
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
  posteriorChain: number, anteriorChain: number, unilateralStability: number, elasticTendon: number,
  axialLoadModifier: number, tendonLoadModifier: number, eccentricRiskModifier: number, highIntensityRunningRisk: number,
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
  // Foster monotony (mean ÷ population SD of the trailing 7-day UTSS) and
  // strain (weekly UTSS × monotony). Null when SD is 0 (identical/all-rest week).
  monotony: number | null;
  strain: number | null;
  // Display-only objective load. Banister TRIMP (HR) and power TSS, accumulated
  // in parallel to UTSS — they never feed UTSS, so the governor stays calibrated.
  trimp: number | null;
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

export function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function addDays(date: string, delta: number): string {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + delta);
  return toIsoDate(d);
}

export function daysBetween(earlier: string, later: string): number {
  return Math.round((parseIsoDate(later).getTime() - parseIsoDate(earlier).getTime()) / DAY_MS);
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

function normalizeTags(tags: readonly ExerciseLoadTagInput[] | readonly ExerciseLoadTag[]): Map<string, ExerciseLoadTagInput> {
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
  return set.category === "strength" ||
    (reps > 0 && weight > 0) ||
    (reps > 0 && (set.category === "conditioning" || set.category === "functional"));
}

function isCardioSet(set: TrainingLoadSet): boolean {
  return set.category === "running" || set.category === "conditioning" || Number(set.distance ?? set.plannedDistance ?? 0) > 0;
}

function rpeFactor(rpe: number | null | undefined): number {
  if (!rpe) return 1;
  return round(Math.pow(1.18, Math.max(0, rpe - 6)), 3);
}

export function calculateStrengthStressScore(
  set: Pick<TrainingLoadSet, "reps" | "weight" | "plannedReps" | "plannedWeight" | "distance" | "plannedDistance">,
  tag: ExerciseLoadTagInput,
  rpe?: number | null,
  weightUnit: string = "kg",
): number {
  const reps = Number(set.reps ?? set.plannedReps ?? 0);
  // UTSS must represent physiological load, not the athlete's display unit, so
  // normalize the stored weight (kept in the user's unit — see the S5 sentinel
  // in shared/unitConversion) to canonical kg before computing tonnage. This
  // keeps the absolute governor thresholds and the weighted-vs-bodyweight mix
  // comparable across kg and lb athletes. Read-only: we never write this back.
  const weight = userWeightToKg(Number(set.weight ?? set.plannedWeight ?? 0), weightUnit);
  const distance = Number(set.distance ?? set.plannedDistance ?? 0);
  let weightedTonnage = 0;
  if (weight > 0 && reps > 0) {
    weightedTonnage = weight * Math.max(reps, 1);
  } else if (reps > 0) {
    weightedTonnage = reps * 20;
  } else if (distance > 0) {
    weightedTonnage = distance * 0.08;
  }
  if (weightedTonnage <= 0) return 0;
  const modifier = Math.max(0.4, tag.axialLoadModifier) * Math.max(0.6, tag.eccentricRiskModifier);
  return round((weightedTonnage / 100) * rpeFactor(rpe) * modifier, 2);
}

function inferWorkoutText(log: Pick<WorkoutLog, "focus" | "mainWorkout" | "accessory" | "notes">): string {
  return [log.focus, log.mainWorkout, log.accessory ?? "", log.notes ?? ""].join(" ").toLowerCase();
}

// ── Objective cardio load (heart rate / power) ───────────────────────────────
// When a workout carries HR or power data we derive the cardio intensity factor
// from that objective signal instead of RPE/keywords. The factor stays in the
// SAME 0.6–2.6 band the RPE branch produces (RPE uses 0.6 + (rpe/10)²·2), so
// UTSS magnitudes — and every governor threshold calibrated to them — keep the
// same scale. Raw Banister TRIMP / power TSS are computed separately for display
// only (banisterTrimp / powerTss) and never feed UTSS.
const DEFAULT_HR_REST = 60;
const DEFAULT_HR_MAX = 190;
const MAX_CARDIO_INTENSITY_FACTOR = 2.6;

// Tanaka 2001 age-predicted max HR, falling back to a flat default when age is
// unknown.
export function estimateHrMax(age?: number | null): number {
  return age && age > 0 ? Math.round(208 - 0.7 * age) : DEFAULT_HR_MAX;
}

function resolveHrMax(athlete?: AthleteLoadContext): number {
  return athlete?.maxHr && athlete.maxHr > 0 ? athlete.maxHr : estimateHrMax(athlete?.age);
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
  const hrMax = resolveHrMax(athlete);
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

// Banister TRIMP — display-only objective internal load (NOT added to UTSS).
// Gender coefficients: male b=1.92,k=0.64 / female b=1.67,k=0.86. Null without
// usable HR + duration.
export function banisterTrimp(
  durationMin: number | null | undefined,
  avgHr: number | null | undefined,
  athlete?: AthleteLoadContext,
): number | null {
  const duration = Number(durationMin ?? 0);
  const hrr = hrReserveRatio(avgHr, athlete);
  if (duration <= 0 || hrr == null) return null;
  const female = athlete?.gender === "female";
  const b = female ? 1.67 : 1.92;
  const k = female ? 0.86 : 0.64;
  return round(duration * hrr * k * Math.exp(b * hrr), 1);
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
  log: Pick<WorkoutLog, "rpe" | "avgHeartrate" | "avgWatts" | "focus" | "mainWorkout" | "accessory" | "notes">,
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
  const highRisk = sets.some((set) => getTag(tags, set.exerciseName, set.category).highIntensityRunningRisk >= 0.75);
  if (highRisk) return 2.3;
  const text = inferWorkoutText(log);
  if (/\b(sprint|interval|track|hill|threshold|tempo|zone\s*[45]|z[45])\b/.test(text)) return 2.1;
  if (/\b(long|road|downhill)\b/.test(text)) return 1.35;
  if (/\b(recovery|easy|zone\s*2|z2|maf)\b/.test(text)) return 0.9;
  return 1.1;
}

export function calculateCardioStressScore(
  log: Pick<WorkoutLog, "duration" | "rpe" | "avgHeartrate" | "avgWatts" | "focus" | "mainWorkout" | "accessory" | "notes">,
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
  vectorLoads.elastic_tendon += stress * tag.elasticTendon * Math.max(1, tag.tendonLoadModifier) * cardioScale;
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
      trimp: null,
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

// Foster monotony classification. Monotony > 2.0 is a well-known overtraining /
// illness predictor; 1.5–2.0 is an early-warning band.
export function monotonyZone(monotony: number | null): TrainingMonotonyZone {
  if (monotony == null) return "ok";
  if (monotony > 2) return "high_risk";
  if (monotony >= 1.5) return "elevated";
  return "ok";
}

// Foster monotony (mean ÷ population SD of the trailing 7 days of UTSS) and
// strain (weekly UTSS × monotony). Population SD (÷n over the fixed 7-day
// window) keeps a single hard day in an otherwise-easy week finite. When SD is 0
// (every day identical, including an all-rest week) monotony is undefined, so we
// return null and the UI shows N/A rather than Infinity.
function computeMonotonyStrain(
  days: Map<string, DailyTrainingLoad>,
  endDate: string,
): { monotony: number | null; strain: number | null } {
  const values: number[] = [];
  for (let offset = 0; offset < 7; offset++) {
    values.push(days.get(addDays(endDate, -offset))?.utss ?? 0);
  }
  const total = values.reduce((sum, v) => sum + v, 0);
  const mean = total / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return { monotony: null, strain: null };
  const monotony = round(mean / sd, 2);
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

// Single forward pass: maintain running acute/chronic EWMAs and derive ACWR,
// zone, TSB (chronic − acute, "Form"), and Foster monotony/strain for each day.
function applyLoadDynamics(
  days: Map<string, DailyTrainingLoad>,
  start: string,
  end: string,
  firstLogDate: string | null,
): void {
  const ratioFrom = firstLogDate ? addDays(firstLogDate, ACWR_MIN_HISTORY_DAYS - 1) : null;
  let acute: number | null = null;
  let chronic: number | null = null;

  for (const date of dateRange(start, end)) {
    const day = getOrCreateDay(days, date);
    const { monotony, strain } = computeMonotonyStrain(days, date);
    day.monotony = monotony;
    day.strain = strain;

    // Pre-history: no baseline to seed from yet.
    if (firstLogDate == null || date < firstLogDate) {
      day.acwr = null;
      day.zone = "insufficient_data";
      day.acuteEwma = null;
      day.chronicEwma = null;
      day.tsb = null;
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
    day.tsb = round(chronic - acute, 1);

    if (ratioFrom == null || date < ratioFrom) {
      day.acwr = null;
      day.zone = "insufficient_data";
      continue;
    }
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
  return value >= ABSOLUTE_VECTOR_LOAD_THRESHOLD ||
    (priorMax >= ABSOLUTE_VECTOR_LOAD_THRESHOLD && value >= priorMax * 0.9);
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

function sevenDayVectorTotal(allDays: Map<string, DailyTrainingLoad>, currentDate: string, vector: LoadVector): number {
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
    restrictions.push(restriction(
      "posterior_chain_velocity_lock",
      "Posterior chain velocity lock",
      "danger",
      addDays(posterior.date, 2),
      "Recent hamstring/glute/back load conflicts with hills, sprints, and high-velocity running.",
      "posterior_chain",
    ));
  }

  const anterior = findRecentHighVector(allDays, currentDate, "anterior_chain", 2);
  if (anterior) {
    restrictions.push(restriction(
      "anterior_chain_braking_guard",
      "Anterior chain braking guard",
      "caution",
      addDays(anterior.date, 3),
      "Recent quad/patellar load conflicts with downhill, long-road, and braking-heavy runs.",
      "anterior_chain",
    ));
  }

  const elasticTotal = sevenDayVectorTotal(allDays, currentDate, "elastic_tendon");
  if (elasticTotal >= ELASTIC_SEVEN_DAY_THRESHOLD) {
    restrictions.push(restriction(
      "elastic_tendon_speed_guard",
      "Elastic tendon speed guard",
      "danger",
      addDays(currentDate, 3),
      "Seven-day calf/Achilles/plantar load is high, so speed and plyometric sessions should downshift.",
      "elastic_tendon",
    ));
  }

  if (currentZone === "danger") {
    restrictions.push(restriction(
      "acwr_danger_lock",
      "ACWR danger lock",
      "danger",
      addDays(currentDate, 4),
      "Acute UTSS is more than 1.5x the chronic baseline, so high-intensity programming is locked down.",
    ));
  } else if (currentZone === "yellow") {
    restrictions.push(restriction(
      "acwr_yellow_guard",
      "ACWR yellow guard",
      "caution",
      addDays(currentDate, 2),
      "Acute UTSS is above the preferred chronic baseline range, so upcoming intensity should be monitored.",
    ));
  } else if (currentZone === "undertraining") {
    restrictions.push(restriction(
      "acwr_onramp",
      "ACWR on-ramp",
      "info",
      addDays(currentDate, 3),
      "Recent training load is below the 28-day baseline, so re-entry should ramp before peak loads return.",
    ));
  }

  return restrictions;
}

function buildOverview(
  allDays: Map<string, DailyTrainingLoad>,
  currentDate: string,
  rangeStart: string,
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
  const flaggedVectors = [...new Set(activeRestrictions.flatMap((r) => r.vector ? [r.vector] : []))];
  const trendStart = rangeStart > addDays(currentDate, -(TREND_DAYS - 1))
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
      trimp: day.trimp,
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
    trimp: currentDay.trimp,
    tss: currentDay.tss,
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

function computeRangeStart(workoutLogs: readonly Pick<WorkoutLog, "date">[], currentDate: string): string {
  const earliestLog = earliestLogDate(workoutLogs);
  const minNeeded = addDays(currentDate, -(TREND_DAYS + 28));
  if (!earliestLog || earliestLog > minNeeded) return minNeeded;
  return earliestLog;
}

function shouldApplyCardioStress(
  log: Pick<WorkoutLog, "duration" | "focus" | "mainWorkout" | "accessory" | "notes">,
  sets: readonly TrainingLoadSet[],
): boolean {
  return Boolean(
    log.duration &&
      (sets.length === 0 ||
        sets.some(isCardioSet) ||
        /run|bike|row|ski|walk|hike/i.test(inferWorkoutText(log))),
  );
}

function applyStrengthLoad(
  day: DailyTrainingLoad,
  log: Pick<WorkoutLog, "rpe">,
  sets: readonly TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput>,
  weightUnit: string,
): void {
  for (const set of sets) {
    if (!isStrengthSet(set)) continue;
    const setTag = getTag(tags, set.exerciseName, set.category);
    const stress = calculateStrengthStressScore(set, setTag, log.rpe, weightUnit);
    day.strengthStressScore += stress;
    updateVectorLoads(day.vectorLoads, stress, setTag);
  }
}

function applyCardioLoad(
  day: DailyTrainingLoad,
  log: Pick<WorkoutLog, "duration" | "rpe" | "avgHeartrate" | "avgWatts" | "focus" | "mainWorkout" | "accessory" | "notes">,
  sets: readonly TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput>,
  athlete?: AthleteLoadContext,
): void {
  if (!shouldApplyCardioStress(log, sets)) return;

  const stress = calculateCardioStressScore(log, [...sets], tags, athlete);
  day.cardioStressScore += stress;

  // Display-only objective load, accumulated in parallel to UTSS (never feeds it).
  const trimp = banisterTrimp(log.duration, log.avgHeartrate, athlete);
  if (trimp != null) day.trimp = round((day.trimp ?? 0) + trimp, 1);
  const tss = powerTss(log.duration, log.avgWatts, athlete?.ftp);
  if (tss != null) day.tss = round((day.tss ?? 0) + tss, 1);

  const cardioSets = sets.filter(isCardioSet);
  if (cardioSets.length === 0) return;

  // Deliberate stacking: a mixed/circuit set contributes its tonnage to the
  // vectors via the strength path AND a 0.25-damped share of the workout's
  // duration-based cardio stress here — mirroring how UTSS itself sums
  // strength + cardio for the same session. The damping is the calibration;
  // don't "deduplicate" without recalibrating thresholds downstream.
  const stressPerSet = stress / cardioSets.length;
  for (const set of cardioSets) {
    updateVectorLoads(day.vectorLoads, stressPerSet, getTag(tags, set.exerciseName, set.category), 0.25);
  }
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
  applyStrengthLoad(day, log, sets, tags, weightUnit);
  applyCardioLoad(day, log, sets, tags, athlete);
  finalizeDailyLoad(day);
}

export function calculateTrainingLoad(
  workoutLogs: readonly WorkoutLog[],
  exerciseSets: readonly TrainingLoadSet[],
  loadTags: readonly ExerciseLoadTagInput[] | readonly ExerciseLoadTag[] = [],
  options: { currentDate?: string; weightUnit?: string; athlete?: AthleteLoadContext } = {},
): TrainingLoadComputation {
  const currentDate = options.currentDate ?? toIsoDate(new Date());
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
  applyLoadDynamics(allDays, rangeStart, currentDate, firstLogDate);

  return {
    // ⚡ Bolt Performance Optimization:
    // Fast string comparison for YYYY-MM-DD dates instead of localeCompare.
    // Avoids unnecessary overhead since ISO dates sort lexicographically.
    dailyLoads: Array.from(allDays.values()).sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    }),
    overview: buildOverview(allDays, currentDate, rangeStart),
  };
}
