/**
 * "Did the session do its job?" — the database side of session grading.
 *
 * Loads what a grade needs (the plan day's purpose, the athlete's zones and
 * paces, the run's stored stream or its summary metrics), grades each run with
 * the pure engine in this folder, and rolls the grades up by plan week and
 * training block. Nothing is stored: a grade is recomputed on every read, so a
 * new max HR, a fetched stream or a retuned threshold shows up straight away.
 */
import { addDaysToISODate } from "@shared/dateUtils";
import { isIndoorRunSportType, isRunSportType } from "@shared/deviceSportTypes";
import { computeCurrentWeek, isPlanEnded, planWeekForDisplay } from "@shared/planPhase";
import type {
  PlanDay,
  SessionGrade,
  SessionGradesResponse,
  SessionStreamState,
  TrainingPlan,
  User,
  WorkoutLog,
  WorkoutLogStream,
} from "@shared/schema";
import type { SessionStreamSamples } from "@shared/schema/sessionStream";
import { classifyRunPurpose, gradingIntentFor, type RunPurposeResult, type SessionGradeIntent } from "@shared/sessionIntent";

import { AppError, ErrorCode } from "../../errors";
import type { IStorage } from "../../storage";
import { getLocalDateStrSafe } from "../../timezone";
import { isStravaAutoSyncEnabled } from "../stravaAutoSyncFlag";
import { buildRunPaceZones, collectRunEfforts, type RunEffort, type RunPaceZones } from "../workoutEngine/running";
import {
  MAX_BUCKETS,
  PACE_HISTORY_DAYS,
  SESSION_STREAM_BACKFILL_DAYS,
  SESSION_STREAM_MAX_ATTEMPTS,
} from "./constants";
import { headlineFor } from "./evidence";
import { gradeRun, isDefinite } from "./gradeSession";
import { buildSessionGradeRollups, type RollupDay } from "./rollups";
import { resolveGradeTargets } from "./targets";
import type { SummaryMetrics } from "./types";

const DEFINITE_RANK = 1;
const STREAM_RANK = 2;
const DELOAD_TEXT = /\bdeload\b/i;

interface GradeableRun {
  log: WorkoutLog;
  day: PlanDay;
  purpose: RunPurposeResult & { purpose: NonNullable<RunPurposeResult["purpose"]> };
  intent: SessionGradeIntent;
  sportType: string | null;
}

export interface GradeLogsOptions {
  /** Already-loaded plan days, keyed by id (the plan route has them). */
  planDays?: ReadonlyMap<string, PlanDay>;
  /** Already-loaded exercise keys per plan day. */
  exerciseNamesByDay?: ReadonlyMap<string, readonly string[]>;
  /** Already-loaded plans, for their engine fitness. */
  plans?: readonly TrainingPlan[];
  user?: User;
  now?: Date;
}

function sportTypeOf(log: WorkoutLog): string | null {
  const raw = log.deviceActivity?.raw.sport_type;
  if (raw) return raw;
  // Device imports carry the sport as their focus ("Run"); a hand-written log
  // on a run day is a run by the athlete's own account.
  return log.source === "manual" ? null : log.focus;
}

function isRun(log: WorkoutLog, sportType: string | null): boolean {
  // No sport on record: only the athlete's own log on a run day counts as a run.
  return sportType === null ? log.source === "manual" : isRunSportType(sportType);
}

function toSummary(log: WorkoutLog): SummaryMetrics {
  let avgSpeed = log.avgSpeed ?? null;
  if (!avgSpeed && log.distanceMeters && log.duration) avgSpeed = log.distanceMeters / (log.duration * 60);
  return {
    avgHr: log.avgHeartrate ?? null,
    maxHr: log.maxHeartrate ?? null,
    avgSpeed,
    durationMin: log.duration ?? null,
  };
}

/** Stored buckets are trusted only in the shape this code writes. */
function validSamples(value: unknown): value is SessionStreamSamples {
  if (typeof value !== "object" || value === null) return false;
  const samples = value as Partial<SessionStreamSamples>;
  const length = samples.mov?.length ?? -1;
  return (
    samples.v === 1 &&
    typeof samples.bucketSeconds === "number" &&
    samples.bucketSeconds > 0 &&
    Array.isArray(samples.hr) &&
    Array.isArray(samples.dist) &&
    Array.isArray(samples.mov) &&
    length > 0 &&
    length <= MAX_BUCKETS &&
    samples.hr.length === length &&
    samples.dist.length === length &&
    typeof samples.has === "object"
  );
}

function streamStateOf(log: WorkoutLog, row: WorkoutLogStream | undefined, backfillSince: string): SessionStreamState {
  if (!log.stravaActivityId) return "not_applicable";
  const current = row && row.stravaActivityId === log.stravaActivityId ? row : undefined;
  const fetchable = isStravaAutoSyncEnabled() && log.date >= backfillSince;
  if (!current) return fetchable ? "pending" : "unavailable";
  if (current.status === "failed" && current.attempts < SESSION_STREAM_MAX_ATTEMPTS && fetchable) return "pending";
  return current.status as SessionStreamState;
}

function athleteOf(user: User | undefined) {
  return {
    athlete: { age: user?.age ?? null, restingHr: user?.restingHr ?? null, maxHr: user?.maxHr ?? null },
    mafCeilingHr: user?.trainingStyleId === "maf_method" ? (user.mafHr ?? null) : null,
    distanceUnit: user?.distanceUnit ?? "km",
  };
}

/**
 * Fitted paces as of each date, from the runs in the window before it. Built
 * lazily: most plan-linked runs have a pace in the plan text or the plan's
 * engine fitness, and never need the history.
 */
function historyZonesLoader(storage: IStorage, userId: string, runs: readonly GradeableRun[], distanceUnit: string) {
  let efforts: Promise<RunEffort[]> | null = null;
  const load = () => {
    const dates = runs.map((run) => run.log.date).sort((a, b) => a.localeCompare(b));
    const from = addDaysToISODate(dates[0] ?? "1970-01-01", -PACE_HISTORY_DAYS);
    const to = dates.at(-1) ?? from;
    return storage.analytics
      .getWorkoutLogsByDateRange(userId, from, to, { onlyTraining: true })
      .then((logs) => collectRunEfforts(logs, [], distanceUnit));
  };
  return async (date: string): Promise<RunPaceZones | null> => {
    efforts ??= load();
    const since = addDaysToISODate(date, -PACE_HISTORY_DAYS);
    return buildRunPaceZones((await efforts).filter((effort) => effort.date >= since && effort.date < date));
  };
}

async function exerciseNamesFor(
  storage: IStorage,
  userId: string,
  dayIds: string[],
  known?: ReadonlyMap<string, readonly string[]>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (known) return known;
  const sets = await storage.workouts.getExerciseSetsByPlanDays(dayIds, userId);
  return new Map([...sets.entries()].map(([dayId, rows]) => [dayId, rows.map((row) => row.exerciseName)]));
}

/** The one log per plan day the rollups count: the best-recorded, then the longest. */
function markRollupLogs(grades: SessionGrade[], durations: ReadonlyMap<string, number>): void {
  const rank = (grade: SessionGrade) =>
    (grade.dataSource === "stream" ? STREAM_RANK : 0) + (isDefinite(grade.verdict) ? DEFINITE_RANK : 0);
  const best = new Map<string, SessionGrade>();
  for (const grade of grades) {
    const current = best.get(grade.planDayId);
    const better =
      !current ||
      rank(grade) > rank(current) ||
      (rank(grade) === rank(current) &&
        (durations.get(grade.workoutLogId) ?? 0) > (durations.get(current.workoutLogId) ?? 0));
    if (better) best.set(grade.planDayId, grade);
  }
  for (const grade of grades) grade.countsInRollup = best.get(grade.planDayId) === grade;
}

/**
 * Grade the plan-linked runs among `logs`. Anything else — a strength day, a
 * ride linked to an easy-run day, a session we do not grade yet — gets no
 * entry. Returns immediately, with no queries, when nothing is plan-linked.
 */
export async function gradeWorkoutLogs(
  storage: IStorage,
  userId: string,
  logs: readonly WorkoutLog[],
  options: GradeLogsOptions = {},
): Promise<Map<string, SessionGrade>> {
  const linked = logs.filter((log) => log.planDayId);
  if (linked.length === 0) return new Map();

  const dayIds = [...new Set(linked.map((log) => log.planDayId as string))];
  const days =
    options.planDays ??
    new Map((await storage.plans.getPlanDaysByIds(dayIds, userId)).map((day) => [day.id, day]));
  const exerciseNames = await exerciseNamesFor(storage, userId, dayIds, options.exerciseNamesByDay);

  const runs: GradeableRun[] = [];
  for (const log of linked) {
    const day = days.get(log.planDayId as string);
    if (!day) continue;
    const purpose = classifyRunPurpose({
      focus: day.focus,
      mainWorkout: day.mainWorkout,
      exerciseNames: exerciseNames.get(day.id) ?? [],
    });
    const intent = gradingIntentFor(purpose.purpose);
    const sportType = sportTypeOf(log);
    if (!intent || !purpose.purpose || !isRun(log, sportType)) continue;
    runs.push({ log, day, purpose: { ...purpose, purpose: purpose.purpose }, intent, sportType });
  }
  if (runs.length === 0) return new Map();

  const [user, streams, plans] = await Promise.all([
    options.user ?? storage.users.getUser(userId),
    storage.sessionStreams.getForLogs(userId, runs.map((run) => run.log.id)),
    options.plans ?? storage.plans.listTrainingPlans(userId),
  ]);
  const { athlete, mafCeilingHr, distanceUnit } = athleteOf(user);
  const vdotByPlan = new Map(plans.map((plan) => [plan.id, plan.engineState?.runVdot ?? null]));
  const history = historyZonesLoader(storage, userId, runs, distanceUnit);
  const now = options.now ?? new Date();
  const backfillSince = addDaysToISODate(getLocalDateStrSafe(now, user?.userTimezone), -SESSION_STREAM_BACKFILL_DAYS);

  const grades: SessionGrade[] = [];
  for (const run of runs) {
    const planText = run.day.mainWorkout;
    const engineVdot = vdotByPlan.get(run.day.planId) ?? null;
    let targets = resolveGradeTargets({ intent: run.intent, athlete, mafCeilingHr, planText, engineVdot, historyZones: null });
    const needsPace = run.intent === "easy" ? targets.easyPace === null : targets.thresholdPace === null;
    if (needsPace) {
      const historyZones = await history(run.log.date);
      if (historyZones) {
        targets = resolveGradeTargets({ intent: run.intent, athlete, mafCeilingHr, planText, engineVdot, historyZones });
      }
    }

    const row = streams.get(run.log.id);
    const streamStatus = streamStateOf(run.log, row, backfillSince);
    const usable =
      row &&
      row.stravaActivityId === run.log.stravaActivityId &&
      (row.status === "ok" || row.status === "no_heartrate") &&
      validSamples(row.samples);
    const outcome = gradeRun({
      intent: run.intent,
      samples: usable ? (row.samples) : null,
      summary: toSummary(run.log),
      ctx: {
        targets,
        distanceUnit,
        speedTrusted: !isIndoorRunSportType(run.sportType) && run.log.deviceActivity?.raw.trainer !== true,
        hardFinishMinutes: run.purpose.hardFinishMinutes,
      },
    });

    grades.push({
      workoutLogId: run.log.id,
      planDayId: run.day.id,
      planId: run.day.planId,
      date: run.log.date,
      weekNumber: run.day.weekNumber,
      title: run.day.focus,
      intent: run.intent,
      purpose: run.purpose.purpose,
      intentReason: run.purpose.reason,
      verdict: outcome.verdict,
      headline: headlineFor(run.intent, outcome.verdict),
      evidence: outcome.evidence,
      confidence: outcome.confidence,
      dataSource: outcome.dataSource,
      streamStatus,
      ungradeableReason: outcome.ungradeableReason,
      targets,
      easy: outcome.easy,
      threshold: outcome.threshold,
      countsInRollup: true,
    });
  }

  markRollupLogs(grades, new Map(runs.map((run) => [run.log.id, run.log.duration ?? 0])));
  return new Map(grades.map((grade) => [grade.workoutLogId, grade]));
}

const EMPTY_RESPONSE: SessionGradesResponse = { plan: null, sessions: [], weeks: [], blocks: [], totals: null };

/**
 * One plan's graded sessions with their week and block rollups. Defaults to
 * the athlete's active plan; an explicit plan id that is not theirs is a 404.
 */
export async function buildPlanSessionGrades(
  storage: IStorage,
  userId: string,
  planId?: string,
  now: Date = new Date(),
): Promise<SessionGradesResponse> {
  const id = planId ?? (await storage.plans.getActivePlan(userId))?.id;
  if (!id) return EMPTY_RESPONSE;
  const plan = await storage.plans.getTrainingPlan(id, userId);
  if (!plan) {
    if (planId) throw new AppError(ErrorCode.NOT_FOUND, "Training plan not found", 404);
    return EMPTY_RESPONSE;
  }

  const dayIds = plan.days.map((day) => day.id);
  const [logs, user, exerciseNames] = await Promise.all([
    storage.workouts.listLogsForPlan(userId, plan.id),
    storage.users.getUser(userId),
    exerciseNamesFor(storage, userId, dayIds),
  ]);
  const grades = await gradeWorkoutLogs(storage, userId, logs, {
    planDays: new Map(plan.days.map((day) => [day.id, day])),
    exerciseNamesByDay: exerciseNames,
    plans: [plan],
    user,
    now,
  });

  const rollupDays: RollupDay[] = plan.days.map((day) => ({
    weekNumber: day.weekNumber,
    gradeable:
      gradingIntentFor(
        classifyRunPurpose({ focus: day.focus, mainWorkout: day.mainWorkout, exerciseNames: exerciseNames.get(day.id) ?? [] })
          .purpose,
      ) !== null,
    mentionsDeload: DELOAD_TEXT.test(`${day.focus} ${day.mainWorkout} ${day.notes ?? ""}`),
  }));
  const sessions = [...grades.values()].sort((a, b) => b.date.localeCompare(a.date));
  const { weeks, blocks, totals } = buildSessionGradeRollups({
    totalWeeks: plan.totalWeeks,
    startDate: plan.startDate,
    days: rollupDays,
    grades: sessions,
  });

  const today = getLocalDateStrSafe(now, user?.userTimezone);
  const week = computeCurrentWeek(plan.startDate, plan.totalWeeks, today);
  return {
    plan: {
      id: plan.id,
      name: plan.name,
      totalWeeks: plan.totalWeeks,
      startDate: plan.startDate,
      currentWeek: plan.startDate && !isPlanEnded(week, plan.totalWeeks) ? planWeekForDisplay(week, plan.totalWeeks) : null,
    },
    sessions,
    weeks,
    blocks,
    totals,
  };
}
