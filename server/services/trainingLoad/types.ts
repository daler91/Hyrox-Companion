// Training load taxonomy (audit A7: split out of trainingLoadService.ts).
//
// The public types of the load model, the four injury-load vectors, the default
// per-exercise tag table and the lookup that resolves an exercise name to a tag
// row. Pure vocabulary: nothing here scores load or reads the calendar.

import {
  EXERCISE_DEFINITIONS,
  type ExerciseLoadTag,
  type HrZone,
  type InsertExerciseSet,
  type LoadGovernorAcwrZone,
  type LoadGovernorVector,
  type TrainingLoadOverview,
  type WorkoutSuggestion,
} from "@shared/schema";

export type LoadVector = LoadGovernorVector;

export const LOAD_VECTOR_KEYS = [
  "posterior_chain",
  "anterior_chain",
  "unilateral_stability",
  "elastic_tendon",
] as const satisfies readonly LoadVector[];

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

export function normalizeTags(
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

export function inferTag(exerciseName: string, category?: string | null): ExerciseLoadTagInput {
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

export function getTag(
  tags: Map<string, ExerciseLoadTagInput>,
  exerciseName: string,
  category?: string | null,
): ExerciseLoadTagInput {
  return tags.get(exerciseName) ?? inferTag(exerciseName, category);
}
