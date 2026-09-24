/**
 * What plan generation knows about the athlete before the first model call:
 * their recent load (a posture line for week 1, per-exercise load anchors for
 * every chunk) and the exercise-selection brief (which exercises, and why).
 *
 * Split out of planGenerationService so that file stays about generating and
 * validating plans. Everything here reads the same 70-day window once and
 * degrades piece by piece: an unreadable history costs the posture and the
 * anchors, never the brief's goal/constraint/experience reasoning, and nothing
 * here can fail a generation.
 */
import { addDaysToISODate } from "@shared/dateUtils";
import type { GeneratePlanInput, TrainingLoadOverview } from "@shared/schema";
import { buildStationCoverage, stationsRuledOutByConstraints } from "@shared/stationCoverage";
import { standardizeDistanceUnit, standardizeWeightUnit } from "@shared/unitConversion";

import { logger } from "../logger";
import { storage } from "../storage";
import { getLocalDateStrSafe } from "../timezone";
import { buildExerciseSelectionBrief, type ExerciseSelectionBrief } from "./ai/exerciseSelection";
import { buildCoverageSources } from "./analyticsService";
import { buildLoadAnchors, type LoadAnchor } from "./loadAnchors";
import { calculateTrainingLoad } from "./trainingLoadService";
import { ADAPTATION_WINDOW_DAYS } from "./workoutEngine/adaptation";
import { buildWorkoutEnginePlan, type WorkoutEnginePlan } from "./workoutEngine/enginePlan";

// Look-back window for the athlete's current training-load posture, matching the
// coach/analytics load context.
const LOAD_WINDOW_DAYS = 70;

/** What generation knows about the athlete's current loads. `startLoadPosture`
 *  calibrates only the opening week; `loadAnchors` go to EVERY chunk — they are
 *  the shared state that makes parallel chunks agree (audit H17/M7). The
 *  exercise-selection brief is shared state of the same kind, for WHICH
 *  exercises rather than how heavy. */
export interface GenerationCalibration {
  readonly startLoadPosture: string | null;
  readonly loadAnchors: readonly LoadAnchor[];
  readonly exerciseSelection?: ExerciseSelectionBrief | null;
  /**
   * The workout engine's answer for the whole plan — weekly rhythm, primary
   * lift targets, run paces and volume, station doses. Built on the brief's
   * lens and primary lifts, so it is null whenever the brief is.
   */
  readonly engine?: WorkoutEnginePlan | null;
  /**
   * Recent training logs the plan's numbers were computed from. The plan's
   * engine state starts with them marked adapted, so the auto-coach does not
   * apply the same sessions a second time on its first pass.
   */
  readonly reflectedLogIds?: readonly string[];
}

/**
 * Turn the athlete's current training-load posture into one line of opening-week
 * calibration guidance for the generator, or null when no special handling is
 * warranted (sweet spot / not enough history). Exported for testing.
 */
export function describeStartLoadPosture(overview: TrainingLoadOverview): string | null {
  const acwr = overview.acwr != null ? ` (ACWR ${overview.acwr.toFixed(2)})` : "";
  switch (overview.zone) {
    case "danger":
      return `The athlete is carrying high recent load${acwr} and is currently fatigued. Start week 1 conservatively — moderate volume and intensity, no peak or simulation sessions in the first few days — and let them absorb load before ramping.`;
    case "yellow":
      return `The athlete's recent load is elevated${acwr}. Ease into week 1 (trim volume on the hardest sessions) before progressing normally.`;
    case "undertraining":
      return `The athlete is currently detrained / below their 28-day baseline${acwr}. Ramp volume gently across the first 1-2 weeks instead of starting at full prescription.`;
    default:
      return null; // sweet_spot / insufficient_data ⇒ no special calibration
  }
}

type GenerationUser = Awaited<ReturnType<typeof storage.users.getUser>>;

/** The parts of a generation request the brief reads. */
type GenerationSelectionInput = Pick<
  GeneratePlanInput,
  "goal" | "focusAreas" | "experienceLevel" | "injuries"
>;

/** The parts the engine reads on top of the brief's: the plan's shape. */
type GenerationEngineInput = GenerationSelectionInput &
  Pick<GeneratePlanInput, "daysPerWeek" | "restDays"> & {
    readonly totalWeeks: number;
    readonly raceDate?: string;
  };

/** The athlete's last 70 days, read once and shared by every calibration. */
interface GenerationHistory {
  readonly workoutLogs: Awaited<ReturnType<typeof storage.analytics.getWorkoutLogsByDateRange>>;
  readonly sets: Awaited<ReturnType<typeof storage.analytics.getAllExerciseSetsWithDates>>;
  readonly loadTags: Awaited<ReturnType<typeof storage.analytics.getExerciseLoadTags>>;
}

async function loadGenerationHistory(
  userId: string,
  today: string,
): Promise<GenerationHistory | null> {
  try {
    const from = addDaysToISODate(today, -LOAD_WINDOW_DAYS);
    const [workoutLogs, sets, loadTags] = await Promise.all([
      storage.analytics.getWorkoutLogsByDateRange(userId, from, today),
      storage.analytics.getAllExerciseSetsWithDates(userId, from, today),
      storage.analytics.getExerciseLoadTags(),
    ]);
    return { workoutLogs, sets, loadTags };
  } catch {
    logger.warn("[planGen] training history unavailable; generating without it.");
    return null;
  }
}

// The qualitative posture line for week 1 and the per-exercise load anchors
// every chunk receives (audit H17/M7 — the sets were already being fetched
// here and used only for the posture sentence). Degrades to neither on any
// failure — never blocks plan generation.
function describeLoadCalibration(
  history: GenerationHistory | null,
  user: GenerationUser,
  today: string,
): Pick<GenerationCalibration, "startLoadPosture" | "loadAnchors"> {
  if (!history) return { startLoadPosture: null, loadAnchors: [] };
  try {
    const { overview } = calculateTrainingLoad(
      history.workoutLogs,
      history.sets,
      history.loadTags,
      {
        currentDate: today,
        weightUnit: user?.weightUnit || "kg",
        distanceUnit: user?.distanceUnit || "km",
        athlete: {
          age: user?.age ?? null,
          gender: user?.gender ?? null,
          restingHr: user?.restingHr ?? null,
          // Scales unweighted-rep tonnage with the body being moved (audit M2).
          bodyweightKg: user?.bodyweightKg ?? null,
          maxHr: user?.maxHr ?? null,
          ftp: user?.ftp ?? null,
        },
      },
    );
    return {
      startLoadPosture: describeStartLoadPosture(overview),
      loadAnchors: buildLoadAnchors(history.sets, standardizeWeightUnit(user?.weightUnit)),
    };
  } catch {
    logger.warn("[planGen] load calibration unavailable; generating without it.");
    return { startLoadPosture: null, loadAnchors: [] };
  }
}

/**
 * The constraints this plan is written for. The route saves the wizard's box
 * to the profile before queueing, so the two normally agree; the input wins
 * because it is what the athlete just confirmed for THIS plan.
 */
function generationConstraints(
  input: GenerationSelectionInput,
  user: GenerationUser,
): string | null {
  return input.injuries ?? user?.trainingConstraints ?? null;
}

/**
 * Training sessions only — the same split buildTrainingContext makes: a walk
 * is real load, but it is not an exercise habit or a strength estimate.
 */
function trainingHistory(history: Pick<GenerationHistory, "workoutLogs" | "sets"> | null): {
  workoutLogs: GenerationHistory["workoutLogs"];
  sets: GenerationHistory["sets"];
} {
  const workoutLogs = history?.workoutLogs ?? [];
  const nonTrainingLogIds = new Set(
    workoutLogs.filter((log) => log.countsAsTraining === false).map((log) => log.id),
  );
  return {
    workoutLogs: workoutLogs.filter((log) => log.countsAsTraining !== false),
    sets: (history?.sets ?? []).filter((set) => !nonTrainingLogIds.has(set.workoutLogId)),
  };
}

/**
 * The exercise-selection brief for this plan. Without history it still knows
 * the goal, focus areas, constraints and experience level, which settle a lot
 * about exercise choice on their own. Never blocks plan generation.
 */
export function buildGenerationSelection(
  input: GenerationSelectionInput,
  user: GenerationUser,
  today: string,
  history: Pick<GenerationHistory, "workoutLogs" | "sets"> | null,
): ExerciseSelectionBrief | null {
  try {
    const constraints = generationConstraints(input, user);
    const { workoutLogs: trainingLogs, sets } = trainingHistory(history);
    // Same suppression as the coach's computeExerciseGaps, so a station the
    // athlete can't train is never reported as a gap to close.
    const ruledOut = new Set(stationsRuledOutByConstraints(constraints));
    const stationGaps = buildStationCoverage(buildCoverageSources(trainingLogs, sets), today)
      .filter((entry) => !ruledOut.has(entry.station))
      .map((entry) => ({ station: entry.station, daysSince: entry.daysSince }));

    return buildExerciseSelectionBrief({
      goal: input.goal,
      focusAreas: input.focusAreas,
      experienceLevel: input.experienceLevel,
      constraints,
      today,
      weightUnit: user?.weightUnit,
      distanceUnit: user?.distanceUnit,
      sets,
      stationGaps,
      division: user?.division,
      gender: user?.gender,
    });
  } catch (err) {
    logger.warn({ err }, "[planGen] exercise-selection brief unavailable; generating without it.");
    return null;
  }
}

/**
 * The workout engine's plan-wide targets. Needs the brief (its lens and
 * primary lifts); without history it still lays out the weekly rhythm, the
 * effort-based lift progression and the station doses. Never blocks plan
 * generation.
 */
export function buildGenerationEngine(
  input: GenerationEngineInput,
  user: GenerationUser,
  today: string,
  history: Pick<GenerationHistory, "workoutLogs" | "sets"> | null,
  brief: ExerciseSelectionBrief | null,
): WorkoutEnginePlan | null {
  if (!brief) return null;
  try {
    const { workoutLogs, sets } = trainingHistory(history);
    return buildWorkoutEnginePlan({
      lens: brief.lens,
      experience: brief.experienceLevel,
      primaryLifts: brief.primaryLifts,
      goal: input.goal,
      focusAreas: input.focusAreas,
      constraints: generationConstraints(input, user),
      totalWeeks: input.totalWeeks,
      daysPerWeek: input.daysPerWeek,
      restDays: input.restDays,
      hasRace: Boolean(input.raceDate),
      today,
      weightUnit: standardizeWeightUnit(user?.weightUnit),
      distanceUnit: standardizeDistanceUnit(user?.distanceUnit),
      division: user?.division,
      gender: user?.gender,
      sets,
      logs: workoutLogs,
    });
  } catch (err) {
    logger.warn({ err }, "[planGen] workout engine unavailable; generating without it.");
    return null;
  }
}

export async function computeGenerationCalibration(
  userId: string,
  user: GenerationUser,
  input: GenerationEngineInput,
): Promise<GenerationCalibration> {
  // The athlete's calendar date, not the server's: a UTC "today" put the
  // load window a day off for everyone west of Greenwich, so the posture and
  // anchors the plan was calibrated from lagged the schedule it was written
  // against (resolveUserTodayForPlan makes the same call for the schedule).
  const today = getLocalDateStrSafe(new Date(), user?.userTimezone);
  const history = await loadGenerationHistory(userId, today);
  const exerciseSelection = buildGenerationSelection(input, user, today, history);
  return {
    ...describeLoadCalibration(history, user, today),
    exerciseSelection,
    engine: buildGenerationEngine(input, user, today, history, exerciseSelection),
    reflectedLogIds: reflectedLogIds(history, today),
  };
}

/** The training logs recent enough that adaptation would otherwise pick them up. */
export function reflectedLogIds(
  history: Pick<GenerationHistory, "workoutLogs"> | null,
  today: string,
): string[] {
  const since = addDaysToISODate(today, -ADAPTATION_WINDOW_DAYS);
  return trainingHistory(history ? { workoutLogs: history.workoutLogs, sets: [] } : null)
    .workoutLogs.filter((log) => log.date >= since)
    .map((log) => log.id);
}
