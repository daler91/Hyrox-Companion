import { addDaysToISODate as addDays, toIsoDateUtc } from "@shared/dateUtils";
import {
  type ExerciseLoadTag,
  type LoadGovernorAcwrZone,
  normalizeExerciseName,
  type TrainingLoadOverview,
  type TrainingLoadRestriction,
  type WorkoutLog,
} from "@shared/schema";

import {
  classifyHrZone,
  estimateLthr,
  hrTss,
  hrZoneBoundaries,
  hrZoneRank,
  powerTss,
} from "./trainingLoad/hrModel";
import { applyLoadDynamics, EWMA_WARMUP_DAYS, monotonyZone } from "./trainingLoad/loadDynamics";
import {
  calculateCardioStressScore,
  calculateStrengthStressScore,
} from "./trainingLoad/stressScores";
import {
  type AthleteLoadContext,
  type DailyTrainingLoad,
  type ExerciseLoadTagInput,
  getTag,
  inferTag,
  LOAD_VECTOR_KEYS,
  type LoadVector,
  normalizeTags,
  type TrainingLoadComputation,
  type TrainingLoadSet,
} from "./trainingLoad/types";
import { dateRange, getOrCreateDay, inferWorkoutText, round } from "./trainingLoad/utils";

// Training load orchestrator. Walks the athlete's logs day by day, scores each
// workout (trainingLoad/stressScores.ts), attributes load to the injury vectors,
// runs the EWMA / ACWR / monotony pass (trainingLoad/loadDynamics.ts) and builds
// the overview with its vector restrictions. The taxonomy and the physiology
// live in trainingLoad/*; every symbol this module used to export is re-exported
// below so importers and test mocks keep addressing it here (audit A7).
//
// CALIBRATION COUPLING. The vector thresholds and restriction windows below are
// read against the UTSS scale defined in trainingLoad/stressScores.ts and
// trainingLoad/hrModel.ts. Do not move them without checking that scale.
export {
  classifyHrZone,
  estimateHrMax,
  estimateLthr,
  hrIntensityFactor,
  hrReserveRatio,
  hrTss,
  hrZoneBoundaries,
  powerIntensityFactor,
  powerTss,
} from "./trainingLoad/hrModel";
export { EWMA_WARMUP_DAYS, monotonyZone, resolveAcwrZone } from "./trainingLoad/loadDynamics";
export {
  bodyweightRepLoadKg,
  calculateCardioStressScore,
  calculateStrengthStressScore,
} from "./trainingLoad/stressScores";
export {
  type AthleteLoadContext,
  type DailyTrainingLoad,
  DEFAULT_EXERCISE_LOAD_TAGS,
  type ExerciseLoadTagInput,
  LOAD_VECTOR_KEYS,
  type LoadGovernorSuggestion,
  type LoadVector,
  type PromptExerciseForLoad,
  type TrainingLoadComputation,
  type TrainingLoadSet,
  type UpcomingWorkoutForLoad,
} from "./trainingLoad/types";

const TREND_DAYS = 42;
const ABSOLUTE_VECTOR_LOAD_THRESHOLD = 45;
const ELASTIC_SEVEN_DAY_THRESHOLD = 80;

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

function buildSetMap(sets: readonly TrainingLoadSet[]): Map<string, TrainingLoadSet[]> {
  const map = new Map<string, TrainingLoadSet[]>();
  for (const set of sets) {
    const existing = map.get(set.workoutLogId) ?? [];
    existing.push(set);
    map.set(set.workoutLogId, existing);
  }
  return map;
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
  distanceUnit?: string,
): void {
  for (const set of sets) {
    if (!isStrengthSet(set)) continue;
    const setTag = getTag(tags, set.exerciseName, set.category);
    const stress = calculateStrengthStressScore(set, setTag, log.rpe, weightUnit, athlete?.bodyweightKg, distanceUnit);
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
  distanceUnit?: string,
): void {
  applyStrengthLoad(day, log, sets, tags, weightUnit, athlete, distanceUnit);
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
    /** The athlete's distance preference; only consulted for rows with no unit stamp. */
    distanceUnit?: string;
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
  const distanceUnit = options.distanceUnit;
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
    applyWorkoutLoad(day, log, sets, tags, weightUnit, athlete, distanceUnit);
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
