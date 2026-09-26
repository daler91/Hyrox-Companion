/**
 * "Did the session do its job?" — the database side of session grading.
 *
 * Takes what a grade needs from sessionGradeData.ts (the plan day's purpose,
 * the athlete's zones and paces, the run's stored stream), grades each run with
 * the pure engine in this folder, and rolls the grades up by plan week and
 * training block. Nothing is stored: a grade is recomputed on every read, so a
 * new max HR, a fetched stream or a retuned threshold shows up straight away.
 */
import { isIndoorRunSportType } from "@shared/deviceSportTypes";
import { computeCurrentWeek, isPlanEnded, planWeekForDisplay } from "@shared/planPhase";
import type { SessionGrade, SessionGradesResponse, WorkoutLog } from "@shared/schema";

import { AppError, ErrorCode } from "../../errors";
import type { IStorage } from "../../storage";
import { getLocalDateStrSafe } from "../../timezone";
import { headlineFor } from "./evidence";
import { gradeRun, isDefinite } from "./gradeSession";
import { buildSessionGradeRollups, type RollupDay } from "./rollups";
import {
  exerciseNamesFor,
  gradeableDayPurpose,
  type GradeableRun,
  type GradeContext,
  type GradeLogsOptions,
  loadGradeContext,
  streamInputFor,
} from "./sessionGradeData";
import { resolveGradeTargets } from "./targets";
import type { SummaryMetrics } from "./types";

export type { GradeLogsOptions } from "./sessionGradeData";

const DEFINITE_RANK = 1;
const STREAM_RANK = 2;
const DELOAD_TEXT = /\bdeload\b/i;

function toSummary(log: WorkoutLog): SummaryMetrics {
  let avgSpeed = log.avgSpeed ?? null;
  if (!avgSpeed && log.distanceMeters && log.duration) {
    avgSpeed = log.distanceMeters / (log.duration * 60);
  }
  return {
    avgHr: log.avgHeartrate ?? null,
    maxHr: log.maxHeartrate ?? null,
    avgSpeed,
    durationMin: log.duration ?? null,
  };
}

/** The one log per plan day the rollups count: the best-recorded, then the longest. */
function markRollupLogs(grades: SessionGrade[], durations: ReadonlyMap<string, number>): void {
  const rank = (grade: SessionGrade) =>
    (grade.dataSource === "stream" ? STREAM_RANK : 0) +
    (isDefinite(grade.verdict) ? DEFINITE_RANK : 0);
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

/** HR and pace targets for one run; the run history is read only when no other pace source has one. */
async function targetsFor(run: GradeableRun, context: GradeContext) {
  const base = {
    intent: run.intent,
    athlete: context.athlete,
    mafCeilingHr: context.mafCeilingHr,
    planText: run.day.mainWorkout,
    engineVdot: context.vdotByPlan.get(run.day.planId) ?? null,
  };
  const targets = resolveGradeTargets({ ...base, historyZones: null });
  const needsPace =
    run.intent === "easy" ? targets.easyPace === null : targets.thresholdPace === null;
  if (!needsPace) return targets;
  const historyZones = await context.historyZones(run.log.date);
  return historyZones ? resolveGradeTargets({ ...base, historyZones }) : targets;
}

async function gradeOne(run: GradeableRun, context: GradeContext): Promise<SessionGrade> {
  const targets = await targetsFor(run, context);
  const stream = streamInputFor(run, context);
  const outcome = gradeRun({
    intent: run.intent,
    samples: stream.samples,
    summary: toSummary(run.log),
    ctx: {
      targets,
      distanceUnit: context.distanceUnit,
      speedTrusted:
        !isIndoorRunSportType(run.sportType) && run.log.deviceActivity?.raw.trainer !== true,
      hardFinishMinutes: run.purpose.hardFinishMinutes,
    },
  });
  return {
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
    streamStatus: stream.status,
    ungradeableReason: outcome.ungradeableReason,
    targets,
    easy: outcome.easy,
    threshold: outcome.threshold,
    countsInRollup: true,
  };
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
  const context = await loadGradeContext(storage, userId, logs, options);
  if (!context) return new Map();

  // Runs that need the pace history share its one lazily started load.
  const grades = await Promise.all(context.runs.map((run) => gradeOne(run, context)));

  markRollupLogs(grades, new Map(context.runs.map((run) => [run.log.id, run.log.duration ?? 0])));
  return new Map(grades.map((grade) => [grade.workoutLogId, grade]));
}

const EMPTY_RESPONSE: SessionGradesResponse = {
  plan: null,
  sessions: [],
  weeks: [],
  blocks: [],
  totals: null,
};

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
    gradeable: gradeableDayPurpose(day, exerciseNames) !== null,
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
      currentWeek:
        plan.startDate && !isPlanEnded(week, plan.totalWeeks)
          ? planWeekForDisplay(week, plan.totalWeeks)
          : null,
    },
    sessions,
    weeks,
    blocks,
    totals,
  };
}
