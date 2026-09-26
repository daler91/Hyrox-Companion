/**
 * The loading half of session grading: which plan-linked logs are gradeable
 * runs, and everything their grades read — the plan day's purpose, the
 * athlete's zones, the plan's engine fitness, stored streams and (only when a
 * pace target needs it) the run history. sessionGradeService.ts turns this
 * into grades and rollups.
 */
import { addDaysToISODate } from "@shared/dateUtils";
import { isRunSportType } from "@shared/deviceSportTypes";
import type {
  PlanDay,
  SessionStreamState,
  TrainingPlan,
  User,
  WorkoutLog,
  WorkoutLogStream,
} from "@shared/schema";
import type { SessionStreamSamples } from "@shared/schema/sessionStream";
import {
  classifyRunPurpose,
  gradingIntentFor,
  type RunPurposeResult,
  type SessionGradeIntent,
} from "@shared/sessionIntent";

import type { IStorage } from "../../storage";
import { getLocalDateStrSafe } from "../../timezone";
import { isStravaAutoSyncEnabled } from "../stravaAutoSyncFlag";
import {
  buildRunPaceZones,
  collectRunEfforts,
  type RunEffort,
  type RunPaceZones,
} from "../workoutEngine/running";
import {
  MAX_BUCKETS,
  PACE_HISTORY_DAYS,
  SESSION_STREAM_BACKFILL_DAYS,
  SESSION_STREAM_MAX_ATTEMPTS,
} from "./constants";
import type { TargetInputs } from "./targets";

export interface GradeableRun {
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

/** What every grade in one call shares. */
export interface GradeContext {
  runs: GradeableRun[];
  streams: ReadonlyMap<string, WorkoutLogStream>;
  athlete: TargetInputs["athlete"];
  mafCeilingHr: number | null;
  distanceUnit: string;
  vdotByPlan: ReadonlyMap<string, number | null>;
  /** Fitted paces as of a date, from the runs before it. */
  historyZones: (date: string) => Promise<RunPaceZones | null>;
  /** Oldest date the stream fetcher still backfills. */
  backfillSince: string;
}

/** The stored stream as a grade sees it. */
export interface StreamInput {
  samples: SessionStreamSamples | null;
  status: SessionStreamState;
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

function streamStateOf(
  log: WorkoutLog,
  current: WorkoutLogStream | undefined,
  backfillSince: string,
): SessionStreamState {
  if (!log.stravaActivityId) return "not_applicable";
  const fetchable = isStravaAutoSyncEnabled() && log.date >= backfillSince;
  if (!current) return fetchable ? "pending" : "unavailable";
  if (current.status === "failed" && current.attempts < SESSION_STREAM_MAX_ATTEMPTS && fetchable)
    return "pending";
  return current.status as SessionStreamState;
}

/**
 * The run's stored stream, when it is for the activity the log is linked to
 * now and in a shape we can read, and the state the grade card reports.
 */
export function streamInputFor(run: GradeableRun, context: GradeContext): StreamInput {
  const row = context.streams.get(run.log.id);
  // A row left from a different linked activity is not this run's stream.
  const current = row && row.stravaActivityId === run.log.stravaActivityId ? row : undefined;
  const usable =
    current !== undefined &&
    (current.status === "ok" || current.status === "no_heartrate") &&
    validSamples(current.samples);
  return {
    samples: usable ? current.samples : null,
    status: streamStateOf(run.log, current, context.backfillSince),
  };
}

function athleteOf(user: User | undefined) {
  return {
    athlete: {
      age: user?.age ?? null,
      restingHr: user?.restingHr ?? null,
      maxHr: user?.maxHr ?? null,
    },
    mafCeilingHr: user?.trainingStyleId === "maf_method" ? (user.mafHr ?? null) : null,
    distanceUnit: user?.distanceUnit ?? "km",
  };
}

/**
 * Fitted paces as of each date, from the runs in the window before it. Built
 * lazily: most plan-linked runs have a pace in the plan text or the plan's
 * engine fitness, and never need the history.
 */
function historyZonesLoader(
  storage: IStorage,
  userId: string,
  runs: readonly GradeableRun[],
  distanceUnit: string,
) {
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
    return buildRunPaceZones(
      (await efforts).filter((effort) => effort.date >= since && effort.date < date),
    );
  };
}

export async function exerciseNamesFor(
  storage: IStorage,
  userId: string,
  dayIds: string[],
  known?: ReadonlyMap<string, readonly string[]>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (known) return known;
  const sets = await storage.workouts.getExerciseSetsByPlanDays(dayIds, userId);
  return new Map(
    [...sets.entries()].map(([dayId, rows]) => [dayId, rows.map((row) => row.exerciseName)]),
  );
}

/** The plan day's purpose, when it is one we grade. */
export function gradeableDayPurpose(
  day: PlanDay,
  exerciseNames: ReadonlyMap<string, readonly string[]>,
) {
  const purpose = classifyRunPurpose({
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    exerciseNames: exerciseNames.get(day.id) ?? [],
  });
  const intent = gradingIntentFor(purpose.purpose);
  return intent && purpose.purpose
    ? { purpose: { ...purpose, purpose: purpose.purpose }, intent }
    : null;
}

async function selectGradeableRuns(
  storage: IStorage,
  userId: string,
  linked: readonly WorkoutLog[],
  options: GradeLogsOptions,
): Promise<GradeableRun[]> {
  const dayIds = [...new Set(linked.map((log) => log.planDayId as string))];
  const days =
    options.planDays ??
    new Map((await storage.plans.getPlanDaysByIds(dayIds, userId)).map((day) => [day.id, day]));
  const exerciseNames = await exerciseNamesFor(storage, userId, dayIds, options.exerciseNamesByDay);

  const runs: GradeableRun[] = [];
  for (const log of linked) {
    const day = days.get(log.planDayId as string);
    const gradeable = day ? gradeableDayPurpose(day, exerciseNames) : null;
    const sportType = sportTypeOf(log);
    if (day && gradeable && isRun(log, sportType)) runs.push({ log, day, ...gradeable, sportType });
  }
  return runs;
}

/**
 * Everything the grades of `logs` need, or null when none is a plan-linked
 * run we grade. Makes no queries when nothing is plan-linked.
 */
export async function loadGradeContext(
  storage: IStorage,
  userId: string,
  logs: readonly WorkoutLog[],
  options: GradeLogsOptions,
): Promise<GradeContext | null> {
  const linked = logs.filter((log) => log.planDayId);
  if (linked.length === 0) return null;
  const runs = await selectGradeableRuns(storage, userId, linked, options);
  if (runs.length === 0) return null;

  const [user, streams, plans] = await Promise.all([
    options.user ?? storage.users.getUser(userId),
    storage.sessionStreams.getForLogs(
      userId,
      runs.map((run) => run.log.id),
    ),
    options.plans ?? storage.plans.listTrainingPlans(userId),
  ]);
  const { athlete, mafCeilingHr, distanceUnit } = athleteOf(user);
  const today = getLocalDateStrSafe(options.now ?? new Date(), user?.userTimezone);
  return {
    runs,
    streams,
    athlete,
    mafCeilingHr,
    distanceUnit,
    vdotByPlan: new Map(plans.map((plan) => [plan.id, plan.engineState?.runVdot ?? null])),
    historyZones: historyZonesLoader(storage, userId, runs, distanceUnit),
    backfillSince: addDaysToISODate(today, -SESSION_STREAM_BACKFILL_DAYS),
  };
}
