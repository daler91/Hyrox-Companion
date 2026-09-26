import type { PlanDay, WorkoutLog, WorkoutLogStream } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay, createMockTrainingPlanWithDays, createMockUser } from "../../../test/factories";
import { AppError } from "../../errors";
import type { IStorage } from "../../storage";
import { makeWorkoutLog } from "../trainingLoadService.testHelpers";
import { downsampleStravaStreams } from "./downsample";
import { buildPlanSessionGrades, gradeWorkoutLogs } from "./sessionGradeService";
import { ATHLETE, streamFromStretches } from "./testFixtures";

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock("../stravaAutoSyncFlag", () => ({ isStravaAutoSyncEnabled: () => flag.enabled }));

const USER = "user-1";
const NOW = new Date("2026-09-26T12:00:00Z");

const EASY_DAY = createMockPlanDay({
  id: "easy-day",
  planId: "plan-1",
  weekNumber: 2,
  focus: "Easy Run",
  mainWorkout: "40 min easy @ 6:00-6:40/km",
});
const THRESHOLD_DAY = createMockPlanDay({
  id: "threshold-day",
  planId: "plan-1",
  weekNumber: 2,
  focus: "Threshold Run",
  mainWorkout: "15 min easy, 3 x 10 min @ 4:50/km with 2 min jog, 10 min easy",
});
const INTERVAL_DAY = createMockPlanDay({ id: "interval-day", planId: "plan-1", focus: "VO2 Intervals", mainWorkout: "6 x 800 m" });

function stravaRun(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return makeWorkoutLog({
    id: "run-1",
    userId: USER,
    date: "2026-09-22",
    focus: "Run",
    source: "strava",
    stravaActivityId: "9001",
    planDayId: EASY_DAY.id,
    planId: "plan-1",
    duration: 40,
    avgHeartrate: 139,
    maxHeartrate: 146,
    avgSpeed: 2.7,
    distanceMeters: 6500,
    ...overrides,
  });
}

function streamRow(logId: string, overrides: Partial<WorkoutLogStream> = {}): WorkoutLogStream {
  const { samples } = downsampleStravaStreams(streamFromStretches([{ seconds: 2400, paceSecPerKm: 375, hr: 136 }]));
  return {
    id: `stream-${logId}`,
    workoutLogId: logId,
    userId: USER,
    stravaActivityId: "9001",
    status: "ok",
    attempts: 0,
    bucketSeconds: 15,
    samples,
    lastError: null,
    lastAttemptAt: NOW,
    fetchedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function makeStorage(opts: { days?: PlanDay[]; streams?: WorkoutLogStream[]; history?: WorkoutLog[] } = {}) {
  const days = opts.days ?? [EASY_DAY, THRESHOLD_DAY, INTERVAL_DAY];
  const storage = {
    plans: {
      getPlanDaysByIds: vi.fn(async (ids: string[]) => days.filter((day) => ids.includes(day.id))),
      listTrainingPlans: vi.fn().mockResolvedValue([]),
      getActivePlan: vi.fn(),
      getTrainingPlan: vi.fn(),
    },
    workouts: {
      getExerciseSetsByPlanDays: vi.fn().mockResolvedValue(new Map()),
      listLogsForPlan: vi.fn().mockResolvedValue([]),
    },
    users: { getUser: vi.fn().mockResolvedValue(createMockUser({ id: USER, ...ATHLETE, userTimezone: "UTC", distanceUnit: "km" })) },
    sessionStreams: {
      getForLogs: vi.fn().mockResolvedValue(new Map((opts.streams ?? []).map((row) => [row.workoutLogId, row]))),
    },
    analytics: { getWorkoutLogsByDateRange: vi.fn().mockResolvedValue(opts.history ?? []) },
  };
  return { storage: storage as unknown as IStorage, mocks: storage };
}

beforeEach(() => {
  flag.enabled = true;
});

describe("gradeWorkoutLogs", () => {
  it("does no work at all when nothing is plan-linked", async () => {
    const { storage, mocks } = makeStorage();
    const grades = await gradeWorkoutLogs(storage, USER, [makeWorkoutLog({ planDayId: null })]);
    expect(grades.size).toBe(0);
    expect(mocks.plans.getPlanDaysByIds).not.toHaveBeenCalled();
    expect(mocks.users.getUser).not.toHaveBeenCalled();
  });

  it("grades a run from its stored stream against the plan day's purpose", async () => {
    const { storage } = makeStorage({ streams: [streamRow("run-1")] });
    const grade = (await gradeWorkoutLogs(storage, USER, [stravaRun()], { now: NOW })).get("run-1");
    expect(grade).toMatchObject({
      intent: "easy",
      purpose: "easy",
      title: "Easy Run",
      weekNumber: 2,
      verdict: "on_target",
      headline: "Stayed easy",
      dataSource: "stream",
      streamStatus: "ok",
      confidence: "high",
      countsInRollup: true,
    });
    expect(grade?.targets).toMatchObject({ easyCeilingHr: 148, easyPace: { fast: 360, slow: 400 }, paceSource: "plan" });
  });

  it("falls back to the summary while the stream is pending, and says it is pending", async () => {
    const { storage } = makeStorage();
    const grade = (await gradeWorkoutLogs(storage, USER, [stravaRun()], { now: NOW })).get("run-1");
    expect(grade).toMatchObject({ dataSource: "summary", confidence: "low", streamStatus: "pending", verdict: "on_target" });
  });

  it("reports the stream as unavailable, not pending, when background Strava reads are off", async () => {
    flag.enabled = false;
    const { storage } = makeStorage();
    const grade = (await gradeWorkoutLogs(storage, USER, [stravaRun()], { now: NOW })).get("run-1");
    expect(grade?.streamStatus).toBe("unavailable");
  });

  it("ignores a stream fetched for a different activity than the log now carries", async () => {
    const { storage } = makeStorage({ streams: [streamRow("run-1", { stravaActivityId: "old" })] });
    const grade = (await gradeWorkoutLogs(storage, USER, [stravaRun()], { now: NOW })).get("run-1");
    expect(grade).toMatchObject({ dataSource: "summary", streamStatus: "pending" });
  });

  it("does not grade a ride linked to a run day, or a session kind with no grader", async () => {
    const { storage } = makeStorage();
    const ride = stravaRun({
      id: "ride",
      focus: "Ride",
      deviceActivity: { provider: "strava", raw: { sport_type: "Ride" } as never, filledColumns: [], linkedAt: "" },
    });
    const intervals = stravaRun({ id: "intervals", planDayId: INTERVAL_DAY.id });
    const grades = await gradeWorkoutLogs(storage, USER, [ride, intervals], { now: NOW });
    expect(grades.size).toBe(0);
  });

  it("grades a hand-logged run on a run day from what the athlete entered", async () => {
    const { storage } = makeStorage();
    const manual = makeWorkoutLog({
      id: "manual",
      userId: USER,
      date: "2026-09-22",
      focus: "Easy Run",
      source: "manual",
      planDayId: EASY_DAY.id,
      avgHeartrate: 155,
      duration: 40,
    });
    const grade = (await gradeWorkoutLogs(storage, USER, [manual], { now: NOW })).get("manual");
    expect(grade).toMatchObject({ verdict: "too_hard", dataSource: "summary", streamStatus: "not_applicable" });
  });

  it("counts one log per plan day in the rollups, preferring the one with a stream", async () => {
    const { storage } = makeStorage({ streams: [streamRow("with-stream", { stravaActivityId: "2" })] });
    const grades = await gradeWorkoutLogs(
      storage,
      USER,
      [
        stravaRun({ id: "summary-only", stravaActivityId: "1", duration: 60 }),
        stravaRun({ id: "with-stream", stravaActivityId: "2", duration: 40 }),
      ],
      { now: NOW },
    );
    expect(grades.get("with-stream")?.countsInRollup).toBe(true);
    expect(grades.get("summary-only")?.countsInRollup).toBe(false);
  });

  it("only reads run history when the plan gives no pace", async () => {
    const withPace = makeStorage();
    await gradeWorkoutLogs(withPace.storage, USER, [stravaRun()], { now: NOW });
    expect(withPace.mocks.analytics.getWorkoutLogsByDateRange).not.toHaveBeenCalled();

    const bare = createMockPlanDay({ id: "bare", planId: "plan-1", focus: "Easy Run", mainWorkout: "40 min easy" });
    const history = [
      makeWorkoutLog({ id: "h1", date: "2026-09-01", focus: "Run", distanceMeters: 5000, duration: 25, avgSpeed: 5000 / 1500 }),
      makeWorkoutLog({ id: "h2", date: "2026-09-08", focus: "Run", distanceMeters: 10000, duration: 52, avgSpeed: 10000 / 3120 }),
    ];
    const noPace = makeStorage({ days: [bare], history });
    const grade = (
      await gradeWorkoutLogs(noPace.storage, USER, [stravaRun({ planDayId: "bare" })], { now: NOW })
    ).get("run-1");
    expect(noPace.mocks.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith(USER, "2026-06-24", "2026-09-22", {
      onlyTraining: true,
    });
    expect(grade?.targets.paceSource).toBe("history");
  });
});

describe("buildPlanSessionGrades", () => {
  it("grades the active plan and rolls it up by week and block", async () => {
    const plan = createMockTrainingPlanWithDays({
      id: "plan-1",
      name: "Autumn block",
      totalWeeks: 8,
      startDate: "2026-08-03",
      days: [EASY_DAY, THRESHOLD_DAY, INTERVAL_DAY],
    });
    const { storage, mocks } = makeStorage({ streams: [streamRow("run-1")] });
    mocks.plans.getActivePlan.mockResolvedValue(plan);
    mocks.plans.getTrainingPlan.mockResolvedValue(plan);
    mocks.workouts.listLogsForPlan.mockResolvedValue([stravaRun()]);

    const response = await buildPlanSessionGrades(storage, USER, undefined, NOW);

    expect(response.plan).toMatchObject({ id: "plan-1", name: "Autumn block", totalWeeks: 8, currentWeek: 8 });
    expect(response.sessions).toHaveLength(1);
    expect(response.weeks).toHaveLength(8);
    expect(response.weeks[1]?.counts).toMatchObject({ graded: 1, onTarget: 1, plannedGradeable: 2 });
    expect(response.blocks.length).toBeGreaterThanOrEqual(1);
    expect(response.totals).toMatchObject({ graded: 1, onTargetRate: 1 });
  });

  it("returns an empty payload without a plan, and a 404 for a plan that is not the athlete's", async () => {
    const { storage, mocks } = makeStorage();
    mocks.plans.getActivePlan.mockResolvedValue(undefined);
    await expect(buildPlanSessionGrades(storage, USER, undefined, NOW)).resolves.toEqual({
      plan: null,
      sessions: [],
      weeks: [],
      blocks: [],
      totals: null,
    });

    mocks.plans.getTrainingPlan.mockResolvedValue(undefined);
    await expect(buildPlanSessionGrades(storage, USER, "someone-elses", NOW)).rejects.toBeInstanceOf(AppError);
  });
});
