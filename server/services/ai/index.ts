import { hasBodySystemLoadData } from "@shared/bodySystemLoad";
import { addDaysToISODate as addDays, dayDiff } from "@shared/dateUtils";
import type { TrainingLoadOverview } from "@shared/schema";
import { getStoredDistanceUnit, standardizeWeightUnit } from "@shared/unitConversion";
import { formatMinutes, minutes } from "@shared/units";

import { AI_CONTEXT_TIMELINE_LIMIT } from "../../constants";
import type { CoachAbsence, TrainingContext } from "../../gemini/index";
import { logger } from "../../logger";
import { calculateStreak } from "../../routeUtils";
import { storage } from "../../storage";
import { getLocalDateStrSafe } from "../../timezone";
import {
  buildMovementPatternCoverage,
  buildMuscleGroupCoverage,
  calculatePersonalRecords,
  countPersonalRecordsInRange,
} from "../analyticsService";
import { computeRaceReadiness } from "../racePrediction/racePredictionService";
import { calculateBodySystemLoad } from "../trainingLoad/bodySystemLoad";
import { type AthleteLoadContext, calculateTrainingLoad } from "../trainingLoadService";
import { getMondayWeekBoundaries } from "../weeklyProgress";
import type { EngineSet } from "../workoutEngine/loadMath";
import type { EngineRunLog } from "../workoutEngine/running";
import { buildTrainingTargets, type TrainingTargets } from "../workoutEngine/trainingTargets";
import {
  computeCurrentWeek,
  computeExerciseGaps,
  computePlanPhase,
  computeProgressionFlags,
  computeRpeTrend,
  computeWeeklyVolume,
} from "./coachingInsights";
import {
  buildExerciseSelectionBrief,
  type ExerciseSelectionBrief,
  type ExperienceLevel,
  type SelectionSet,
} from "./exerciseSelection";
import { summarizeMafTrend } from "./mafTrend";
import { buildNextSessionFuelling, buildNutritionTrainingContext } from "./nutritionContext";
import { decideTrainingState } from "./trainingDecisionEngine";
import {
  calculateTrainingStats,
  collectRecentSkips,
  collectRecentWorkouts,
  getExerciseBreakdown,
  getStructuredExerciseStats,
} from "./trainingStats";

/**
 * The athlete's race proximity for the decision engine's S3/S4 gates.
 *
 * Both fields were hardcoded (`hasRace: false`, `daysToRace: null`), making
 * every race-proximity protection unreachable while `training_plans.race_date`
 * sat populated (audit H13).
 */
function resolveRaceContext(
  raceDate: string | null,
  today: string,
): { hasRace: boolean; daysToRace: number | null } {
  const daysToRace = raceDate ? dayDiff(today, raceDate) : null;
  return daysToRace != null && daysToRace >= 0
    ? { hasRace: true, daysToRace }
    : { hasRace: false, daysToRace: null };
}

/**
 * Map the RPE trend onto the decision engine's THREE soreness tiers.
 *
 * It was `fatigueFlag ? "high" : "low"`, so "medium" never occurred and the
 * S2_SOFT_RECOVERY_GUARD branch testing for it was dead (audit H13).
 * `fatigueFlag` is itself `avgRpeLast3 >= 8`, so 7+ is the natural middle tier:
 * hard training, not yet alarming. With no rated sessions at all the value is
 * ABSENT rather than "low", which asserted a freshness the app had no evidence
 * for.
 */
function sorenessFromRpe(trend: {
  fatigueFlag: boolean;
  avgRpeLast3?: number;
}): "low" | "medium" | "high" | undefined {
  if (trend.fatigueFlag) return "high";
  if (trend.avgRpeLast3 == null) return undefined;
  return trend.avgRpeLast3 >= 7 ? "medium" : "low";
}

/**
 * How far either side of today a declared absence stays worth telling the coach
 * about. Backwards matches the load-history window, so a range that explains a
 * dip the coach can still see is still explained; forwards is long enough to
 * catch booked travel before it is programmed over.
 */
const ABSENCE_LOOKBACK_DAYS = 70;
// Rows of MAF history to pull for the trend summary. Bounded, but wide enough
// that the 90-day compliance baseline is not starved by a 20-row cap.
const MAF_HISTORY_LIMIT = 200;
const ABSENCE_LOOKAHEAD_DAYS = 28;
/** Hard cap, so an athlete with a long annotation history can't bloat the prompt. */
const MAX_ABSENCES_IN_CONTEXT = 8;

/**
 * The declared absences near enough to today for the coach to reason about,
 * newest first and capped.
 *
 * Overlap, not containment: an injury that started three months ago and is
 * still running is the single most important one to surface, and a containment
 * test would drop it for starting too long ago.
 */
function selectAbsencesForContext(
  annotations: readonly {
    startDate: string;
    endDate: string;
    type: string;
    note: string | null;
  }[],
  today: string,
): CoachAbsence[] {
  const from = addDays(today, -ABSENCE_LOOKBACK_DAYS);
  const to = addDays(today, ABSENCE_LOOKAHEAD_DAYS);
  return annotations
    .filter((a) => a.startDate <= to && a.endDate >= from)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, MAX_ABSENCES_IN_CONTEXT)
    .map((a) => ({
      startDate: a.startDate,
      endDate: a.endDate,
      type: a.type as CoachAbsence["type"],
      note: a.note,
      active: a.startDate <= today && today <= a.endDate,
      medical: a.type === "injury" || a.type === "illness",
    }));
}

/**
 * An injury or illness the athlete says they are in RIGHT NOW.
 *
 * Travel and planned rest are deliberately excluded: being away from your gym
 * is not a recovery state, and counting it as one would drop the athlete into
 * reset_repair for a business trip.
 */
function hasActiveMedicalAbsence(absences: readonly CoachAbsence[]): boolean {
  return absences.some((a) => a.active && a.medical);
}

function mapTestTrendDirection(
  trend: ReturnType<typeof computeRpeTrend>["rpeTrend"],
): "declining" | "improving" | "flat" | "insufficient_data" {
  const trendDirectionMap: Record<
    ReturnType<typeof computeRpeTrend>["rpeTrend"],
    "declining" | "improving" | "flat" | "insufficient_data"
  > = {
    rising: "declining",
    falling: "improving",
    stable: "flat",
    insufficient_data: "insufficient_data",
  };

  return trendDirectionMap[trend];
}

function classifyExperienceLevel(totalWorkouts: number): ExperienceLevel {
  if (totalWorkouts < 20) return "beginner";
  if (totalWorkouts < 80) return "intermediate";
  return "advanced";
}

// A movement pattern / muscle group counts as "neglected" once it hasn't been
// trained in 10+ days — mirrors the station-gap threshold so the coach treats
// coverage gaps consistently.
const COVERAGE_NEGLECT_DAYS = 10;

/**
 * The athlete's stored units, defaulted once.
 *
 * `exercise_sets.weight` and `.distance` are stored in the athlete's own unit,
 * so anything rendering them needs both (audit H16, M8). Resolving them here
 * keeps the defaults in one place and off `buildTrainingContext`'s complexity
 * budget, which they had pushed over the lint ceiling.
 */
function resolveUnitPreferences(user: { weightUnit?: string | null; distanceUnit?: string | null } | undefined): {
  weightUnit: string;
  distanceUnit: string;
} {
  return {
    weightUnit: user?.weightUnit || "kg",
    distanceUnit: user?.distanceUnit || "km",
  };
}

/**
 * Pick the most coaching-relevant recent bests (last ~10 weeks of logged sets)
 * as display-ready strings. Prefers the estimated 1RM (or top weight) so the
 * model can anchor progressive overload, then fills with distance/time bests.
 * Capped to keep the prompt bounded.
 */
function buildPersonalRecordSummaries(
  prs: ReturnType<typeof calculatePersonalRecords>,
  weightUnit: string,
  distanceUnit: string,
): Array<{ exercise: string; metric: string; display: string }> {
  const entries: Array<{ exercise: string; metric: string; display: string; sort: number }> = [];
  for (const [key, pr] of Object.entries(prs)) {
    const exercise = pr.customLabel?.trim() || key.replace(/^custom:/, "").replaceAll("_", " ");
    if (pr.estimated1RM) {
      entries.push({ exercise, metric: "e1rm", display: `e1RM ${pr.estimated1RM.value}${weightUnit}`, sort: pr.estimated1RM.value });
    } else if (pr.maxWeight) {
      entries.push({ exercise, metric: "weight", display: `max weight ${pr.maxWeight.value}${weightUnit}`, sort: pr.maxWeight.value });
    } else if (pr.bestTime) {
      entries.push({ exercise, metric: "time", display: `best time ${formatMinutes(minutes(pr.bestTime.value))}`, sort: 0 });
    } else if (pr.maxDistance) {
      // Stored distance is metres for a km athlete and FEET for a miles athlete,
      // so the label has to follow the preference the way weightUnit already
      // does two lines up (audit H16).
      entries.push({ exercise, metric: "distance", display: `max distance ${pr.maxDistance.value}${getStoredDistanceUnit(distanceUnit)}`, sort: 0 });
    }
  }
  // Weighted lifts first (highest load = most overload-relevant), capped to 8.
  entries.sort((a, b) => b.sort - a.sort);
  return entries.slice(0, 8).map(({ exercise, metric, display }) => ({ exercise, metric, display }));
}

/**
 * Reduce a coverage list to the neglected entries (10+ days, or never trained
 * once the athlete has enough history that "never" is signal, not noise),
 * staleness-first and capped so the prompt stays bounded.
 */
function pickNeglectedCoverage(
  coverage: Array<{ label: string; daysSince: number | null }>,
  hasHistory: boolean,
): Array<{ label: string; daysSince: number | null }> {
  return coverage
    .filter((c) => (c.daysSince === null ? hasHistory : c.daysSince >= COVERAGE_NEGLECT_DAYS))
    .sort((a, b) => (b.daysSince ?? Number.POSITIVE_INFINITY) - (a.daysSince ?? Number.POSITIVE_INFINITY))
    .slice(0, 6)
    .map((c) => ({ label: c.label, daysSince: c.daysSince }));
}

type LoadExerciseSets = Awaited<
  ReturnType<typeof storage.analytics.getAllExerciseSetsWithDates>
>;
type LoadWorkoutLogs = Awaited<ReturnType<typeof storage.analytics.getWorkoutLogsByDateRange>>;

/**
 * Derive the supplementary coaching signals that were added after the original
 * coach context: recent personal records / e1RM, PRs-this-week, plan
 * compliance, movement/muscle coverage gaps, deterministic race readiness and
 * load by body system. All reuse data already loaded by buildTrainingContext
 * (no extra IO) and every field self-suppresses when its signal is absent.
 * Extracted to keep buildTrainingContext's complexity bounded.
 */
function buildSupplementaryInsights(params: {
  loadExerciseSets: LoadExerciseSets;
  loadWorkoutLogs: LoadWorkoutLogs;
  loadGovernor: TrainingLoadOverview;
  totalWorkouts: number;
  weightUnit: string;
  distanceUnit: string;
  userTimezone: string | null | undefined;
  today: string;
  athlete: AthleteLoadContext;
}): Partial<NonNullable<TrainingContext["coachingInsights"]>> {
  const {
    loadExerciseSets,
    loadWorkoutLogs,
    loadGovernor,
    totalWorkouts,
    weightUnit,
    distanceUnit,
    userTimezone,
    today,
    athlete,
  } = params;

  // Recent bests (e1RM/weight/distance/time) + new-bests-this-week.
  const personalRecordMap = calculatePersonalRecords(loadExerciseSets, { weightUnit, distanceUnit });
  const personalRecords = buildPersonalRecordSummaries(personalRecordMap, weightUnit, distanceUnit);
  // "This week" means the athlete's calendar week, the same Monday-anchored
  // window the weekly volume, the review and the email all use. It used to be
  // `today-7 … today` INCLUSIVE of both ends — eight days — which both
  // overcounted and disagreed with the email's count of the same metric
  // (audit M3).
  const { thisMondayStr } = getMondayWeekBoundaries(new Date(), userTimezone);
  const prsThisWeek = countPersonalRecordsInRange(personalRecordMap, thisMondayStr, today);

  // Plan adherence over the window.
  let complianceSum = 0;
  let complianceCount = 0;
  for (const log of loadWorkoutLogs) {
    if (typeof log.compliancePct === "number") {
      complianceSum += log.compliancePct;
      complianceCount++;
    }
  }
  const compliance =
    complianceCount > 0
      ? { avgPct: Math.round(complianceSum / complianceCount), windowDays: 70 }
      : undefined;

  // Movement-pattern / muscle-group balance gaps (distinct from station gaps).
  const hasCoverageHistory = totalWorkouts >= 10;
  const neglectedPatterns = pickNeglectedCoverage(
    buildMovementPatternCoverage(loadExerciseSets, today),
    hasCoverageHistory,
  );
  const neglectedMuscles = pickNeglectedCoverage(
    buildMuscleGroupCoverage(loadExerciseSets, today),
    hasCoverageHistory,
  );

  // Deterministic race-day form readiness from TSB — free (no AI call).
  const raceReadiness = computeRaceReadiness(loadGovernor.tsb, loadGovernor.acuteAvg);

  // Where this week's load landed, from the TRAINING sessions — the same
  // subset the Analytics card reads, so the coach and the chart describe the
  // same numbers.
  const bodySystemLoad = calculateBodySystemLoad(loadWorkoutLogs, loadExerciseSets, {
    currentDate: today,
    distanceUnit,
    athlete,
  });

  return {
    ...(personalRecords.length > 0 ? { personalRecords } : {}),
    ...(prsThisWeek > 0 ? { prsThisWeek } : {}),
    ...(compliance ? { compliance } : {}),
    ...(neglectedPatterns.length > 0 ? { neglectedPatterns } : {}),
    ...(neglectedMuscles.length > 0 ? { neglectedMuscles } : {}),
    ...(raceReadiness.status !== "insufficient_data" ? { raceReadiness } : {}),
    ...(hasBodySystemLoadData(bodySystemLoad) ? { bodySystemLoad } : {}),
  };
}

type UpcomingPlannedDay = Awaited<
  ReturnType<typeof storage.timeline.getUpcomingPlannedDays>
>[number];

/** Shape an upcoming plan day for the coach context, falling back to the planned
 *  prescription for sets that haven't been logged yet. */
function mapUpcomingWorkout(
  d: UpcomingPlannedDay,
): NonNullable<TrainingContext["upcomingWorkouts"]>[number] {
  return {
    planDayId: d.planDayId,
    date: d.date,
    focus: d.focus,
    mainWorkout: d.mainWorkout,
    accessory: d.accessory,
    notes: d.notes,
    aiSource: d.aiSource,
    aiRationale: d.aiRationale,
    aiNoteUpdatedAt: d.aiNoteUpdatedAt,
    aiInputsUsed: d.aiInputsUsed,
    ...((d.exerciseSets?.length ?? 0) > 0
      ? {
          // Upcoming plan-day sets carry their prescription in planned*
          // (actuals stay null until logged) — fall back so the coach sees
          // the prescribed numbers, not blanks.
          exerciseDetails: d.exerciseSets.map((es) => ({
            exerciseName: es.exerciseName,
            customLabel: es.customLabel,
            category: es.category,
            setNumber: es.setNumber,
            reps: es.reps ?? es.plannedReps,
            weight: es.weight ?? es.plannedWeight,
            distance: es.distance ?? es.plannedDistance,
            time: es.time ?? es.plannedTime,
            notes: es.notes,
            sortOrder: es.sortOrder,
          })),
        }
      : {}),
  };
}

/**
 * The athlete's current estimated 1RMs and run paces for the coach, from the
 * reads buildTrainingContext already made. Same failure rule as the brief: a
 * coach without them is the coach this app had before they existed.
 */
function coachTrainingTargetsField(params: {
  readonly sets: readonly EngineSet[];
  readonly logs: readonly EngineRunLog[];
  readonly weightUnit: string;
  readonly distanceUnit: string;
  /** Its primary lifts are listed first: they are the plan's backbone. */
  readonly brief: ExerciseSelectionBrief | undefined;
}): { trainingTargets?: TrainingTargets } {
  try {
    const trainingTargets = buildTrainingTargets({
      sets: params.sets,
      logs: params.logs,
      weightUnit: standardizeWeightUnit(params.weightUnit),
      distanceUnit: params.distanceUnit,
      priority: params.brief?.primaryLifts.map((lift) => lift.exercise) ?? [],
    });
    return trainingTargets ? { trainingTargets } : {};
  } catch (err) {
    // A bug in a pure computation over rows already read: the error carries a
    // message and stack, never the athlete's records.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err }, "[coach] training targets unavailable; coaching without them");
    return {};
  }
}

/**
 * The exercise-selection brief for the coach, from reads buildTrainingContext
 * has already made — no extra IO — as a field to spread into the context.
 * Never allowed to take the context down with it: a coach without the brief
 * is the coach this app had before it existed.
 */
function coachExerciseSelectionField(params: {
  readonly plan: { readonly goal?: string | null } | null | undefined;
  readonly experienceLevel: ExperienceLevel;
  readonly constraints: string | null;
  readonly today: string;
  readonly user: { weightUnit?: string | null; distanceUnit?: string | null; division?: string | null; gender?: string | null } | undefined;
  readonly sets: readonly SelectionSet[];
  readonly stationGaps: readonly { station: string; daysSinceLastTrained: number | null }[] | undefined;
  readonly upcomingDays: readonly UpcomingPlannedDay[];
}): { exerciseSelection?: ExerciseSelectionBrief } {
  try {
    const exerciseSelection = buildExerciseSelectionBrief({
      goal: params.plan?.goal,
      experienceLevel: params.experienceLevel,
      constraints: params.constraints,
      today: params.today,
      weightUnit: params.user?.weightUnit,
      distanceUnit: params.user?.distanceUnit,
      sets: params.sets,
      stationGaps: (params.stationGaps ?? []).map((gap) => ({
        station: gap.station,
        daysSince: gap.daysSinceLastTrained,
      })),
      // Planned sets carry their prescription in planned* until logged — the
      // same fallback mapUpcomingWorkout makes for the prompt.
      upcoming: params.upcomingDays.map((day) => ({
        date: day.date,
        sets: day.exerciseSets.map((es) => ({
          exerciseName: es.exerciseName,
          weight: es.weight ?? es.plannedWeight,
        })),
      })),
      division: params.user?.division,
      gender: params.user?.gender,
    });
    return { exerciseSelection };
  } catch (err) {
    // As above: a pure computation, so the error holds no athlete data.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err }, "[coach] exercise-selection brief unavailable; coaching without it");
    return {};
  }
}

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  // Resolve the athlete before anything that needs a date. "Today" is theirs,
  // not the server's, and it must be ONE value: the coach's narrative date was
  // already athlete-local while the load governor's currentDate and the
  // "PRs this week" window were still UTC, so an athlete west of UTC could be
  // told about today while the numbers underneath reasoned about tomorrow.
  // Costs one indexed read ahead of the concurrent batch, which is noise next
  // to the model call this context feeds.
  const user = await storage.users.getUser(userId);
  // Read once: every window in this function is anchored to the athlete's
  // calendar, and four separate `user?.userTimezone` reads each cost a branch
  // against the function's complexity budget.
  const userTimezone = user?.userTimezone;
  const today = getLocalDateStrSafe(new Date(), userTimezone);
  // Read once: the gap suppression and the context payload both want it, and a
  // second optional-chain would put this function back over its complexity budget.
  const trainingConstraints = user?.trainingConstraints ?? null;
  const loadHistoryStart = addDays(today, -70);
  // Build the (optional) fuelling slice concurrently with the training reads; it
  // short-circuits to undefined when nutrition is off or the athlete has no data.
  const nutritionPromise = buildNutritionTrainingContext(userId);
  const [
    timeline,
    activePlanRecord,
    upcomingDays,
    loadWorkoutLogs,
    loadExerciseSets,
    loadTags,
    annotations,
  ] = await Promise.all([
    // Bound to recent history: this internal caller has no caller-supplied
    // limit, so an unbounded getTimeline() would hydrate the user's entire
    // history (all exercise sets) on every coach/chat context build. See
    // AI_CONTEXT_TIMELINE_LIMIT.
    storage.timeline.getTimeline(userId, undefined, AI_CONTEXT_TIMELINE_LIMIT),
    storage.plans.getActivePlan(userId),
    storage.timeline.getUpcomingPlannedDays(userId, 7),
    storage.analytics.getWorkoutLogsByDateRange(userId, loadHistoryStart, today),
    storage.analytics.getAllExerciseSetsWithDates(userId, loadHistoryStart, today),
    storage.analytics.getExerciseLoadTags(),
    // Unbounded by date: an athlete accumulates a handful of these a year, so
    // the windowing is done in selectAbsencesForContext rather than paying for
    // a range predicate. Same reasoning as TimelineStorage.fetchAbsences.
    storage.timelineAnnotations.list(userId),
  ]);

  const absences = selectAbsencesForContext(annotations, today);
  const activeMedicalAbsence = hasActiveMedicalAbsence(absences);

  const {
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    totalWorkouts,
    completionRate,
    completedDates,
  } = calculateTrainingStats(timeline);
  const exerciseBreakdown = getExerciseBreakdown(timeline);
  const currentStreak = calculateStreak(completedDates, userTimezone);
  const recentWorkouts = collectRecentWorkouts(timeline);
  const structuredExerciseStats = getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (activePlanRecord) {
    const currentWeek = computeCurrentWeek(activePlanRecord.startDate, activePlanRecord.totalWeeks, today);
    activePlan = {
      name: activePlanRecord.name,
      totalWeeks: activePlanRecord.totalWeeks,
      currentWeek,
      goal: activePlanRecord.goal ?? undefined,
    };
  }

  const rpeTrend = computeRpeTrend(recentWorkouts);
  const stationGaps = computeExerciseGaps(timeline, today, trainingConstraints);
  const weeklyGoal = user?.weeklyGoal ?? 0;
  const planPhase = activePlan
    ? computePlanPhase(activePlan.totalWeeks, activePlan.currentWeek ?? 1)
    : undefined;
  const weeklyVolume =
    weeklyGoal > 0 ? computeWeeklyVolume(timeline, weeklyGoal, userTimezone) : undefined;
  const { weightUnit, distanceUnit } = resolveUnitPreferences(user);
  const progressionFlags = computeProgressionFlags(timeline, weightUnit, distanceUnit);
  const athlete: AthleteLoadContext = {
    age: user?.age ?? null,
    gender: user?.gender ?? null,
    restingHr: user?.restingHr ?? null,
    // Scales unweighted-rep tonnage with the body being moved (audit M2).
    bodyweightKg: user?.bodyweightKg ?? null,
    maxHr: user?.maxHr ?? null,
    ftp: user?.ftp ?? null,
  };
  const loadGovernor = calculateTrainingLoad(loadWorkoutLogs, loadExerciseSets, loadTags, {
    currentDate: today,
    weightUnit,
    distanceUnit,
    athlete,
  }).overview;
  const completedLast7d = recentWorkouts.filter((w) => {
    // ⚡ Bolt Performance Optimization:
    // Avoid intermediate Date object allocation by using Date.parse() for YYYY-MM-DD date strings
    const days = Math.floor((Date.now() - Date.parse(w.date)) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 7;
  }).length;
  const experienceLevel = classifyExperienceLevel(totalWorkouts);

  const raceContext = resolveRaceContext(activePlanRecord?.raceDate ?? null, today);

  const decisionTree = decideTrainingState({
    profile: {
      experienceLevel,
      primaryGoal: "improve",
    },
    latestWorkouts: { completedLast7d, avgRpeLast3: rpeTrend.avgRpeLast3 },
    testTrend: {
      direction: mapTestTrendDirection(rpeTrend.rpeTrend),
    },
    // The athlete's real race, from `training_plans.race_date`. Both of these
    // were hardcoded (`hasRace: false`, `daysToRace: null`), which made
    // S3_RACE_WEEK and S4_RACE_SOON permanently unreachable — every
    // race-proximity protection in the decision engine was dead code, while the
    // column it needed existed and was populated (audit H13). A gate fed a
    // literal is worse than no gate: it reads as protection in review.
    raceContext,
    recoveryMarkers: {
      // Sleep quality is not collected anywhere in the product, so it is
      // ABSENT rather than asserted as "ok" — a literal that silently held the
      // S2 soft-recovery guard shut. Same for restingHrDelta, which needs a
      // personal baseline the app does not yet track. Leaving them undefined
      // keeps the branches honest: they cannot fire, and they no longer claim
      // to have been evaluated (audit H13).
      soreness: sorenessFromRpe(rpeTrend),
      // Was hardcoded false, which meant the decision engine had a field for
      // exactly this and nothing ever set it — an athlete could declare an
      // injury and still be told intensity was permitted. This drives a hard
      // recovery stop (phase reset_repair), the same lever the fatigue flag
      // above already pulls via `soreness`, and it clears itself when the
      // declared range ends.
      illnessFlag: activeMedicalAbsence,
    },
  });

  // The load reads above deliberately include sessions the athlete does not
  // count as training, because `loadGovernor` is built from them and a walk is
  // real (if small) load — under-counting it there would soften a safety
  // signal. The supplementary insights below are the other kind of question
  // (what did I train, what am I neglecting, what are my bests), so they get
  // the training-only subset. Narrowed in memory from rows already fetched, so
  // the split costs no extra query on the coach's hot path.
  // Phrased as EXCLUDE-the-known-walks rather than include-the-known-training,
  // on both halves. The column is NOT NULL, so in production the two are the
  // same set — but the include form silently empties when a row arrives without
  // the field (a narrower projection, a partial fixture) and, for sets, when a
  // set's parent log is missing from the logs fetch. Losing an athlete's entire
  // PR map to a shape mismatch is a much worse failure than leaving one walk in.
  const trainingLogs = loadWorkoutLogs.filter((log) => log.countsAsTraining !== false);
  const nonTrainingLogIds = new Set(
    loadWorkoutLogs.filter((log) => log.countsAsTraining === false).map((log) => log.id),
  );
  const trainingSets = loadExerciseSets.filter((set) => !nonTrainingLogIds.has(set.workoutLogId));

  // Supplementary signals (PRs/e1RM, compliance, coverage gaps, race readiness,
  // load by body system) derived from data already loaded above — no extra IO.
  // Each self-suppresses when absent. Extracted to keep this function's
  // complexity bounded.
  const supplementaryInsights = buildSupplementaryInsights({
    loadExerciseSets: trainingSets,
    loadWorkoutLogs: trainingLogs,
    loadGovernor,
    totalWorkouts,
    weightUnit,
    distanceUnit,
    userTimezone,
    today,
    athlete,
  });

  const exerciseSelectionField = coachExerciseSelectionField({
    plan: activePlanRecord,
    experienceLevel,
    constraints: trainingConstraints,
    today,
    user,
    sets: trainingSets,
    stationGaps,
    upcomingDays,
  });

  const trainingTargetsField = coachTrainingTargetsField({
    sets: trainingSets,
    logs: trainingLogs,
    weightUnit,
    distanceUnit,
    brief: exerciseSelectionField.exerciseSelection,
  });

  const coachingInsights: TrainingContext["coachingInsights"] = {
    ...rpeTrend,
    stationGaps,
    // Unconditional like its neighbours; the renderer self-suppresses on empty.
    recentSkips: collectRecentSkips(timeline),
    planPhase,
    weeklyVolume,
    progressionFlags,
    loadGovernor,
    decisionTree: {
      currentPhase: decisionTree.phase,
      allowedWorkoutTypes: decisionTree.allowedWorkoutTypes,
      intensityPermitted: decisionTree.intensityPermitted,
      rationaleCodes: decisionTree.rationaleCodes,
    },
    ...supplementaryInsights,
  };

  // W6: omit userId from these info-level health lines. The logger's requestId
  // mixin already carries correlation, so we don't put a user identifier next
  // to health-derived phase/intensity status (matches the logger.ts S2 rule).
  logger.info(
    {
      context: "health-metrics",
      event: "phase_state_evaluated",
      phase: decisionTree.phase,
      intensityPermitted: decisionTree.intensityPermitted,
      rationaleCodes: decisionTree.rationaleCodes,
    },
    "Training phase decision evaluated",
  );

  if (!decisionTree.intensityPermitted && decisionTree.phase === "performance") {
    logger.info(
      {
        context: "health-metrics",
        event: "strict_phase_intensity_blocked",
        phase: decisionTree.phase,
      },
      "Intensity recommendation blocked in strict phase",
    );
  }

  // MAF athletes get a compact test-trend summary so the coach can validate
  // aerobic progress and nudge test cadence. The two reads are scoped to this
  // style and skipped entirely for everyone else.
  let mafTrend: TrainingContext["mafTrend"];
  if (user?.trainingStyleId === "maf_method") {
    // Explicit limits, and a separate COUNT. The default was a silent 20, so the
    // summary reported "20 tests" to anyone with more and computed its trend from
    // whatever twenty rows happened to be newest (audit M14).
    const [mafTestRows, mafAnalysisRows, mafTestTotal] = await Promise.all([
      storage.mafTests.listTestResults(userId, MAF_HISTORY_LIMIT),
      storage.mafTests.listWorkoutAnalysis(userId, MAF_HISTORY_LIMIT),
      storage.mafTests.countTestResults(userId),
    ]);
    mafTrend = summarizeMafTrend(mafTestRows, mafAnalysisRows, new Date(), {
      totalTestCount: mafTestTotal,
    });
  }

  const nutrition = await nutritionPromise;
  // Phase 3b: when the athlete engages with nutrition (slice present) and has an
  // upcoming planned session, tell the coach what to fuel for it.
  if (nutrition && upcomingDays.length > 0) {
    nutrition.nextSessionFuelling = buildNextSessionFuelling(
      upcomingDays[0],
      user?.bodyweightKg ?? null,
      user?.distanceUnit ?? "km",
    );
  }

  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    currentDate: today,
    // Unconditional, like mafHr below and the recent/upcoming arrays: the
    // renderer already self-suppresses on empty, so a conditional spread here
    // would buy nothing but branches.
    trainingConstraints,
    absences,
    mafHr: user?.mafHr ?? null,
    ...(mafTrend ? { mafTrend } : {}),
    weeklyGoal: user?.weeklyGoal ?? undefined,
    ...(user?.weightUnit ? { weightUnit: user.weightUnit } : {}),
    ...(user?.distanceUnit ? { distanceUnit: user.distanceUnit } : {}),
    ...(nutrition ? { nutrition } : {}),
    ...exerciseSelectionField,
    ...trainingTargetsField,
    recentWorkouts: recentWorkouts.slice(0, 10),
    upcomingWorkouts: upcomingDays.map(mapUpcomingWorkout),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
    coachingInsights,
  };
}
