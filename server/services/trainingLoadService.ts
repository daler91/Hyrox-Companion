import {
  EXERCISE_DEFINITIONS,
  type ExerciseLoadTag,
  type InsertExerciseSet,
  type LoadGovernorAcwrZone,
  type LoadGovernorVector,
  type TrainingLoadOverview,
  type TrainingLoadRestriction,
  type WorkoutLog,
  type WorkoutSuggestion,
} from "@shared/schema";

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
}

export interface DailyTrainingLoad {
  date: string;
  strengthStressScore: number;
  cardioStressScore: number;
  utss: number;
  acwr: number | null;
  zone: LoadGovernorAcwrZone;
  vectorLoads: Record<LoadVector, number>;
}

export interface TrainingLoadComputation {
  dailyLoads: DailyTrainingLoad[];
  overview: TrainingLoadOverview;
}

export const DEFAULT_EXERCISE_LOAD_TAGS: ExerciseLoadTagInput[] = [
  tag("deadlift", 1, 0.2, 0.2, 0.1, 1.5, 1, 1.2, 0),
  tag("sumo_deadlift", 1, 0.25, 0.2, 0.1, 1.45, 1, 1.15, 0),
  tag("stiff_leg_deadlift", 1, 0.1, 0.3, 0.15, 1.35, 1.1, 1.2, 0),
  tag("romanian_deadlift", 1, 0.1, 0.25, 0.15, 1.35, 1.1, 1.2, 0),
  tag("good_morning", 1, 0.1, 0.2, 0.1, 1.45, 1, 1.25, 0),
  tag("single_leg_rdl", 0.85, 0.15, 0.9, 0.2, 1.15, 1.1, 1.15, 0),
  tag("hip_thrust", 0.8, 0.1, 0.1, 0.1, 1.05, 1, 1, 0),
  tag("kettlebell_swings", 0.85, 0.05, 0.2, 0.25, 1.05, 1.05, 1.1, 0),
  tag("back_extension", 0.75, 0, 0.1, 0.1, 1, 1, 1.05, 0),
  tag("back_squat", 0.35, 1, 0.2, 0.1, 1.4, 1, 1.2, 0),
  tag("front_squat", 0.25, 1, 0.2, 0.1, 1.35, 1, 1.15, 0),
  tag("leg_press", 0.2, 1, 0.1, 0.1, 0.8, 1, 1.1, 0),
  tag("hack_squat", 0.2, 1, 0.15, 0.1, 1.05, 1, 1.1, 0),
  tag("lunges", 0.35, 0.95, 0.9, 0.15, 1.1, 1, 1.2, 0),
  tag("reverse_lunge", 0.35, 0.85, 0.9, 0.15, 1.05, 1, 1.15, 0),
  tag("walking_lunges", 0.35, 0.95, 0.9, 0.2, 1.05, 1, 1.2, 0),
  tag("bulgarian_split_squat", 0.35, 0.9, 1, 0.15, 1.1, 1, 1.15, 0),
  tag("sled_push", 0.45, 0.95, 0.35, 0.25, 1.2, 1.1, 1.1, 0),
  tag("sandbag_lunges", 0.35, 1, 0.8, 0.2, 1.15, 1, 1.2, 0),
  tag("wall_balls", 0.2, 0.85, 0.2, 0.25, 0.9, 1.05, 1.1, 0),
  tag("box_jumps", 0.25, 0.75, 0.7, 1, 0.6, 1.5, 1.25, 0.6),
  tag("burpee_broad_jump", 0.55, 0.65, 0.8, 0.9, 0.7, 1.35, 1.2, 0.5),
  tag("jump_rope", 0.1, 0.2, 0.2, 1, 0.5, 1.45, 1, 0.4),
  tag("calf_raise", 0.05, 0.1, 0.15, 0.9, 0.8, 1.35, 1, 0),
  tag("standing_calf_raise", 0.05, 0.1, 0.15, 0.9, 0.8, 1.35, 1, 0),
  tag("seated_calf_raise", 0.05, 0.1, 0.15, 0.8, 0.75, 1.25, 1, 0),
  tag("run_1k", 0.35, 0.45, 0.2, 0.45, 0.4, 1.15, 1.05, 0.45),
  tag("easy_run", 0.2, 0.3, 0.1, 0.25, 0.35, 1, 1, 0.1),
  tag("recovery_run", 0.15, 0.25, 0.1, 0.2, 0.3, 0.9, 0.9, 0),
  tag("tempo_run", 0.45, 0.5, 0.2, 0.55, 0.45, 1.2, 1.05, 0.75),
  tag("interval_run", 0.7, 0.55, 0.25, 0.85, 0.5, 1.45, 1.05, 1),
  tag("hill_repeats", 0.85, 0.55, 0.35, 0.8, 0.55, 1.45, 1.1, 1),
  tag("fartlek_run", 0.45, 0.45, 0.2, 0.55, 0.45, 1.2, 1, 0.65),
  tag("long_run", 0.35, 0.65, 0.15, 0.5, 0.4, 1.15, 1.25, 0.25),
  tag("treadmill_run", 0.25, 0.35, 0.1, 0.35, 0.35, 1.05, 1, 0.25),
  tag("sprints", 0.8, 0.55, 0.35, 0.9, 0.55, 1.5, 1.1, 1),
  tag("treadmill_intervals", 0.65, 0.5, 0.2, 0.75, 0.45, 1.35, 1, 0.9),
  tag("incline_walk", 0.65, 0.45, 0.2, 0.35, 0.35, 1.15, 1, 0.45),
  tag("stair_climber", 0.45, 0.85, 0.25, 0.35, 0.45, 1.15, 1.1, 0.35),
];

function tag(
  exerciseName: string,
  posteriorChain: number,
  anteriorChain: number,
  unilateralStability: number,
  elasticTendon: number,
  axialLoadModifier: number,
  tendonLoadModifier: number,
  eccentricRiskModifier: number,
  highIntensityRunningRisk: number,
): ExerciseLoadTagInput {
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

function toIsoDate(date: Date): string {
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

function daysBetween(earlier: string, later: string): number {
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
  return tag(
    exerciseName,
    running ? Math.max(posterior, 0.2) : posterior,
    running ? Math.max(anterior, 0.25) : anterior,
    0.1,
    running ? Math.max(elastic, 0.25) : elastic,
    cat === "strength" ? 1 : 0.7,
    1,
    running ? 1.05 : 1,
    running ? 0.25 : 0,
  );
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
): number {
  const reps = Number(set.reps ?? set.plannedReps ?? 0);
  const weight = Number(set.weight ?? set.plannedWeight ?? 0);
  const distance = Number(set.distance ?? set.plannedDistance ?? 0);
  const weightedTonnage = weight > 0 && reps > 0
    ? weight * Math.max(reps, 1)
    : reps > 0
      ? reps * 20
      : distance > 0
        ? distance * 0.08
        : 0;
  if (weightedTonnage <= 0) return 0;
  const modifier = Math.max(0.4, tag.axialLoadModifier) * Math.max(0.6, tag.eccentricRiskModifier);
  return round((weightedTonnage / 100) * rpeFactor(rpe) * modifier, 2);
}

function inferWorkoutText(log: Pick<WorkoutLog, "focus" | "mainWorkout" | "accessory" | "notes">): string {
  return [log.focus, log.mainWorkout, log.accessory ?? "", log.notes ?? ""].join(" ").toLowerCase();
}

function inferCardioIntensityFactor(
  log: Pick<WorkoutLog, "rpe" | "focus" | "mainWorkout" | "accessory" | "notes">,
  sets: TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput>,
): number {
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
  log: Pick<WorkoutLog, "duration" | "rpe" | "focus" | "mainWorkout" | "accessory" | "notes">,
  sets: TrainingLoadSet[],
  tags: Map<string, ExerciseLoadTagInput> = normalizeTags([]),
): number {
  const duration = Number(log.duration ?? 0);
  if (duration <= 0) return 0;
  return round(duration * inferCardioIntensityFactor(log, sets, tags), 1);
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

function sumUtss(days: Map<string, DailyTrainingLoad>, endDate: string, windowDays: number): number {
  let total = 0;
  for (let offset = 0; offset < windowDays; offset++) {
    total += days.get(addDays(endDate, -offset))?.utss ?? 0;
  }
  return total;
}

export function resolveAcwrZone(acwr: number | null, chronicAvg: number): LoadGovernorAcwrZone {
  if (acwr == null || chronicAvg <= 0) return "insufficient_data";
  if (acwr < 0.8) return "undertraining";
  if (acwr <= 1.3) return "sweet_spot";
  if (acwr <= 1.5) return "yellow";
  return "danger";
}

function applyAcwr(days: Map<string, DailyTrainingLoad>, start: string, end: string): void {
  for (const date of dateRange(start, end)) {
    const day = getOrCreateDay(days, date);
    const acuteAvg = sumUtss(days, date, 7) / 7;
    const chronicAvg = sumUtss(days, date, 28) / 28;
    const acwr = chronicAvg > 0 ? round(acuteAvg / chronicAvg, 2) : null;
    day.acwr = acwr;
    day.zone = resolveAcwrZone(acwr, chronicAvg);
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
  const acuteAvg = round(sumUtss(allDays, currentDate, 7) / 7, 1);
  const chronicAvg = round(sumUtss(allDays, currentDate, 28) / 28, 1);
  const acwr = chronicAvg > 0 ? round(acuteAvg / chronicAvg, 2) : null;
  const zone = resolveAcwrZone(acwr, chronicAvg);
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
    };
  });

  return {
    currentUtss: round(currentDay.utss, 1),
    acuteAvg,
    chronicAvg,
    acwr,
    zone,
    flaggedVectors,
    activeRestrictions,
    downshiftRationale: activeRestrictions[0]?.rationale ?? null,
    trend,
  };
}

function computeRangeStart(workoutLogs: readonly Pick<WorkoutLog, "date">[], currentDate: string): string {
  const earliestLog = workoutLogs.reduce<string | null>((earliest, log) => {
    if (!earliest || log.date < earliest) return log.date;
    return earliest;
  }, null);
  const minNeeded = addDays(currentDate, -(TREND_DAYS + 28));
  if (!earliestLog || earliestLog > minNeeded) return minNeeded;
  return earliestLog;
}

export function calculateTrainingLoad(
  workoutLogs: readonly WorkoutLog[],
  exerciseSets: readonly TrainingLoadSet[],
  loadTags: readonly ExerciseLoadTagInput[] | readonly ExerciseLoadTag[] = [],
  options: { currentDate?: string } = {},
): TrainingLoadComputation {
  const currentDate = options.currentDate ?? toIsoDate(new Date());
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
    for (const set of sets) {
      const setTag = getTag(tags, set.exerciseName, set.category);
      if (isStrengthSet(set)) {
        const stress = calculateStrengthStressScore(set, setTag, log.rpe);
        day.strengthStressScore += stress;
        updateVectorLoads(day.vectorLoads, stress, setTag);
      }
    }

    if (log.duration && (sets.length === 0 || sets.some(isCardioSet) || /run|bike|row|ski|walk|hike/i.test(inferWorkoutText(log)))) {
      const stress = calculateCardioStressScore(log, sets, tags);
      day.cardioStressScore += stress;
      const cardioSets = sets.filter(isCardioSet);
      if (cardioSets.length > 0) {
        const stressPerSet = stress / cardioSets.length;
        for (const set of cardioSets) {
          updateVectorLoads(day.vectorLoads, stressPerSet, getTag(tags, set.exerciseName, set.category), 0.25);
        }
      }
    }
    day.strengthStressScore = round(day.strengthStressScore, 1);
    day.cardioStressScore = round(day.cardioStressScore, 1);
    day.utss = round(day.strengthStressScore + day.cardioStressScore, 1);
    for (const key of LOAD_VECTOR_KEYS) day.vectorLoads[key] = round(day.vectorLoads[key], 1);
  }

  applyAcwr(allDays, rangeStart, currentDate);

  return {
    dailyLoads: Array.from(allDays.values()).sort((a, b) => a.date.localeCompare(b.date)),
    overview: buildOverview(allDays, currentDate, rangeStart),
  };
}

function workoutText(workout: UpcomingWorkoutForLoad): string {
  return [workout.focus, workout.mainWorkout, workout.accessory ?? "", workout.notes ?? ""].join(" ").toLowerCase();
}

function hasExercise(workout: UpcomingWorkoutForLoad, names: readonly string[]): boolean {
  const nameSet = new Set(names);
  return Boolean(workout.exerciseDetails?.some((exercise) => nameSet.has(exercise.exerciseName)));
}

function isRunningWorkout(workout: UpcomingWorkoutForLoad): boolean {
  return Boolean(workout.exerciseDetails?.some((exercise) => exercise.category === "running")) || /\brun|sprint|track|tempo|threshold|hill\b/.test(workoutText(workout));
}

function isStrengthWorkout(workout: UpcomingWorkoutForLoad): boolean {
  return Boolean(workout.exerciseDetails?.some((exercise) => exercise.category === "strength")) || /\b(squat|deadlift|lunge|leg press|sled|strength)\b/.test(workoutText(workout));
}

function isHighTaxStrengthWorkout(workout: UpcomingWorkoutForLoad): boolean {
  return isStrengthWorkout(workout) &&
    (hasExercise(workout, [
      "deadlift",
      "romanian_deadlift",
      "good_morning",
      "back_squat",
      "front_squat",
      "leg_press",
      "lunges",
      "bulgarian_split_squat",
      "sled_push",
      "sandbag_lunges",
    ]) ||
      /\b(heavy|max|1rm|90%|failure|amrap|high[-\s]?volume|hard|threshold)\b/.test(workoutText(workout)));
}

function isHighIntensityRun(workout: UpcomingWorkoutForLoad): boolean {
  return hasExercise(workout, ["interval_run", "hill_repeats", "tempo_run", "fartlek_run", "sprints", "treadmill_intervals"]) ||
    /\b(sprint|interval|track|hill|threshold|tempo|zone\s*[45]|z[45]|race pace)\b/.test(workoutText(workout));
}

function isBrakingRun(workout: UpcomingWorkoutForLoad): boolean {
  return hasExercise(workout, ["long_run"]) || /\b(downhill|long run|road run|hard descent)\b/.test(workoutText(workout));
}

function isPlyoOrSpeed(workout: UpcomingWorkoutForLoad): boolean {
  return isHighIntensityRun(workout) || hasExercise(workout, ["box_jumps", "burpee_broad_jump", "jump_rope"]);
}

function firstRunExercise(workout: UpcomingWorkoutForLoad): PromptExerciseForLoad | undefined {
  return workout.exerciseDetails?.find((exercise) => exercise.category === "running");
}

function buildEasyRunRows(planDayId: string, workout: UpcomingWorkoutForLoad): InsertExerciseSet[] {
  const run = firstRunExercise(workout);
  return [{
    planDayId,
    workoutLogId: null,
    exerciseName: "recovery_run",
    customLabel: null,
    category: "running",
    setNumber: 1,
    reps: null,
    weight: null,
    distance: run?.distance ?? null,
    time: run?.time ?? null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    notes: "Load governor downshift: flat, low-intensity aerobic session.",
    confidence: 95,
    sortOrder: 0,
  }];
}

function easyRunRecommendation(workout: UpcomingWorkoutForLoad): string {
  const run = firstRunExercise(workout);
  const details = [
    "Flat low-intensity aerobic run",
    run?.time ? `${run.time} min` : null,
    run?.distance ? `${Math.round(run.distance)} m` : null,
  ].filter(Boolean);
  return `${details.join(" - ")}. Keep effort conversational and avoid hills, sprints, track work, and downhill braking.`;
}

function buildSuggestion(
  workout: UpcomingWorkoutForLoad,
  rationale: string,
  rationaleCode: string,
  priority: WorkoutSuggestion["priority"] = "high",
): LoadGovernorSuggestion {
  return {
    rationaleCode,
    suggestion: {
      workoutId: workout.id,
      workoutDate: workout.date,
      workoutFocus: workout.focus,
      targetField: "mainWorkout",
      action: "replace",
      recommendation: easyRunRecommendation(workout),
      rationale,
      priority,
    },
    structuredSetRows: workout.exerciseDetails?.length ? buildEasyRunRows(workout.id, workout) : undefined,
  };
}

function restrictionIds(summary: TrainingLoadOverview): Set<string> {
  return new Set(summary.activeRestrictions.map((restriction) => restriction.id));
}

export function buildLoadGovernorSuggestions(
  summary: TrainingLoadOverview,
  upcomingWorkouts: readonly UpcomingWorkoutForLoad[],
  currentDate = toIsoDate(new Date()),
): LoadGovernorSuggestion[] {
  const restrictions = restrictionIds(summary);
  const suggestions: LoadGovernorSuggestion[] = [];
  const usedWorkoutIds = new Set<string>();
  const ordered = [...upcomingWorkouts].sort((a, b) => a.date.localeCompare(b.date));

  const add = (workout: UpcomingWorkoutForLoad, suggestion: LoadGovernorSuggestion) => {
    if (usedWorkoutIds.has(workout.id)) return;
    suggestions.push(suggestion);
    usedWorkoutIds.add(workout.id);
  };

  for (const workout of ordered) {
    const daysAhead = daysBetween(currentDate, workout.date);
    if (daysAhead < 0) continue;
    if (
      restrictions.has("posterior_chain_velocity_lock") &&
      daysAhead <= 2 &&
      isRunningWorkout(workout) &&
      isHighIntensityRun(workout)
    ) {
      add(workout, buildSuggestion(
        workout,
        "Gym log shows high posterior-chain strain, so this high-velocity run is downshifted to protect hamstrings while preserving aerobic volume.",
        "posterior_chain_velocity_lock",
      ));
      continue;
    }

    if (
      restrictions.has("anterior_chain_braking_guard") &&
      daysAhead <= 3 &&
      isRunningWorkout(workout) &&
      (isBrakingRun(workout) || isHighIntensityRun(workout))
    ) {
      add(workout, buildSuggestion(
        workout,
        "Gym log shows high quad and patellar strain, so this run is shifted to a flat low-intensity session to reduce knee braking load.",
        "anterior_chain_braking_guard",
      ));
      continue;
    }

    if (
      restrictions.has("elastic_tendon_speed_guard") &&
      daysAhead <= 3 &&
      isPlyoOrSpeed(workout)
    ) {
      add(workout, buildSuggestion(
        workout,
        "Seven-day elastic tendon load is high, so speed and plyometric work is downshifted to protect the Achilles and plantar fascia.",
        "elastic_tendon_speed_guard",
      ));
    }
  }

  for (const workout of ordered) {
    const daysAhead = daysBetween(currentDate, workout.date);
    if (daysAhead < 0 || daysAhead > 2 || usedWorkoutIds.has(workout.id)) continue;
    if (restrictions.has("acwr_yellow_guard") && (isHighIntensityRun(workout) || isHighTaxStrengthWorkout(workout))) {
      add(workout, buildSuggestion(
        workout,
        `ACWR is ${summary.acwr ?? "above target"}, so this higher-tax session is softened while acute load settles back toward the chronic baseline.`,
        "acwr_yellow_guard",
        "medium",
      ));
    }
  }

  for (const workout of ordered) {
    const daysAhead = daysBetween(currentDate, workout.date);
    if (daysAhead < 0 || daysAhead > 4 || usedWorkoutIds.has(workout.id)) continue;
    if (restrictions.has("acwr_danger_lock") && (isHighIntensityRun(workout) || isStrengthWorkout(workout))) {
      add(workout, buildSuggestion(
        workout,
        `ACWR is ${summary.acwr ?? "above target"}, so high-intensity training is downshifted to guide load back toward the chronic baseline.`,
        "acwr_danger_lock",
      ));
    }
  }

  let onrampCount = 0;
  for (const workout of ordered) {
    if (!restrictions.has("acwr_onramp") || usedWorkoutIds.has(workout.id)) continue;
    const daysAhead = daysBetween(currentDate, workout.date);
    if (daysAhead < 0 || daysAhead > 3 || onrampCount >= 3) continue;
    if (isHighIntensityRun(workout) || isStrengthWorkout(workout)) {
      add(workout, buildSuggestion(
        workout,
        "Recent training load is below the 28-day baseline, so this session starts a 3-day on-ramp instead of jumping straight back to peak load.",
        "acwr_onramp",
        "medium",
      ));
      onrampCount += 1;
    }
  }

  return suggestions;
}
