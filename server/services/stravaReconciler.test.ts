import type { PlanDay, StravaActivitySummary, WorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { storage } from "../storage";
import {
  attachStravaActivityToLogInTx,
  createLogFromPlanDayWithStravaInTx,
} from "./deviceActivityLink";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import {
  candidateFromLog,
  candidateFromPlanDay,
  deviceActivityInputFromStrava,
  localStartMinutesFromStrava,
  reconcileStravaActivities,
  type StravaImportItem,
} from "./stravaReconciler";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";

vi.mock("../db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("../storage", () => ({
  storage: {
    workouts: {
      listDeviceUnlinkedLogsForDates: vi.fn(),
      createWorkoutLogs: vi.fn(),
      createDeviceActivitySets: vi.fn(),
    },
    plans: { listOpenPlanDaysForDates: vi.fn() },
  },
}));
vi.mock("./deviceActivityLink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deviceActivityLink")>();
  return {
    ...actual,
    attachStravaActivityToLogInTx: vi.fn(),
    createLogFromPlanDayWithStravaInTx: vi.fn(),
  };
});

const USER = "user-1";
const DATE = "2026-09-08";
const silentLog = { info: vi.fn(), warn: vi.fn() };

function stravaRun(overrides: Partial<StravaActivitySummary> = {}): StravaActivitySummary {
  return {
    id: 9001,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-09-08T11:30:00Z",
    start_date_local: "2026-09-08T06:30:00Z",
    distance: 8100,
    moving_time: 45 * 60,
    elapsed_time: 46 * 60,
    total_elevation_gain: 40,
    average_speed: 3.0,
    max_speed: 4.1,
    average_heartrate: 152,
    max_heartrate: 171,
    ...overrides,
  };
}

function item(activity: StravaActivitySummary): StravaImportItem {
  return { activity, row: mapStravaActivityToWorkout(activity, USER, "km") };
}

function planDay(overrides: Partial<PlanDay> = {}): PlanDay {
  return {
    id: "pd-1",
    planId: "plan-1",
    weekNumber: 3,
    dayName: "Tuesday",
    focus: "Easy Run",
    mainWorkout: "8 km easy",
    accessory: null,
    notes: null,
    scheduledDate: DATE,
    status: "planned",
    aiSource: null,
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    expectedDurationMin: 45,
    expectedRpe: null,
    plannedTimeOfDayMin: null,
    skipReason: null,
    ...overrides,
  };
}

/** A tx whose plan-day row lock succeeds and whose plan-day log lookup resolves `existing`. */
function txWithExistingLog(existing: WorkoutLog[]) {
  const tx = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    for: vi.fn().mockResolvedValue([{ id: "pd-1" }]),
    limit: vi.fn().mockResolvedValue(existing),
  };
  return tx;
}

describe("input shaping", () => {
  it("reads the local wall-clock start off start_date_local", () => {
    expect(localStartMinutesFromStrava("2026-09-08T06:30:00Z")).toBe(390);
    expect(localStartMinutesFromStrava("2026-09-08T18:05:59Z")).toBe(1085);
    expect(localStartMinutesFromStrava("")).toBeNull();
  });

  it("maps a Strava row to matcher input", () => {
    expect(deviceActivityInputFromStrava(stravaRun())).toEqual({
      externalId: "9001",
      name: "Morning Run",
      sportType: "Run",
      localDate: DATE,
      localStartMinutes: 390,
      movingTimeSec: 2700,
      distanceMeters: 8100,
    });
  });

  it("maps logs and plan days to candidates with their own duration source", () => {
    const log = makeWorkoutLog({
      id: "log-1",
      duration: 44,
      distanceMeters: 8000,
      timeOfDayMin: 400,
    });
    expect(candidateFromLog(log)).toMatchObject({
      kind: "workout_log",
      id: "log-1",
      durationMin: 44,
      distanceMeters: 8000,
      localStartMinutes: 400,
    });
    expect(candidateFromPlanDay(planDay({ plannedTimeOfDayMin: 420 }))).toMatchObject({
      kind: "plan_day",
      id: "pd-1",
      durationMin: 45,
      distanceMeters: null,
      localStartMinutes: 420,
    });
  });
});

describe("reconcileStravaActivities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.workouts.listDeviceUnlinkedLogsForDates).mockResolvedValue([]);
    vi.mocked(storage.plans.listOpenPlanDaysForDates).mockResolvedValue([]);
    vi.mocked(storage.workouts.createWorkoutLogs).mockImplementation(async (rows) =>
      rows.map((r, i) => ({ ...makeWorkoutLog({ id: `created-${i}` }), ...r })),
    );
    vi.mocked(db.transaction).mockImplementation(async (callback) =>
      callback(txWithExistingLog([]) as never),
    );
  });

  it("attaches the recording to the day's already-logged workout", async () => {
    const logged = makeWorkoutLog({
      id: "log-1",
      date: DATE,
      focus: "Easy Run",
      mainWorkout: "8 km easy",
      duration: 45,
      rpe: 6,
    });
    vi.mocked(storage.workouts.listDeviceUnlinkedLogsForDates).mockResolvedValue([logged]);
    vi.mocked(attachStravaActivityToLogInTx).mockResolvedValue({
      ...logged,
      stravaActivityId: "9001",
    });

    const counts = await reconcileStravaActivities(USER, [item(stravaRun())], silentLog);

    expect(counts).toMatchObject({
      enriched: 1,
      completedPlanDays: 0,
      suggested: 0,
      standalone: 0,
      skipped: 0,
    });
    expect(attachStravaActivityToLogInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        logId: "log-1",
        userId: USER,
        linkSource: "auto",
        confidence: expect.any(Number),
        metrics: expect.objectContaining({ distanceMeters: 8100, avgHeartrate: 152, duration: 45 }),
      }),
    );
    expect(createLogFromPlanDayWithStravaInTx).not.toHaveBeenCalled();
    expect(storage.workouts.createWorkoutLogs).not.toHaveBeenCalled();
  });

  it("completes an open plan day when nothing has been logged for it", async () => {
    const day = planDay();
    vi.mocked(storage.plans.listOpenPlanDaysForDates).mockResolvedValue([day]);
    vi.mocked(createLogFromPlanDayWithStravaInTx).mockResolvedValue(
      makeWorkoutLog({ id: "new", planDayId: day.id }),
    );

    const counts = await reconcileStravaActivities(USER, [item(stravaRun())], silentLog);

    expect(counts).toMatchObject({ enriched: 0, completedPlanDays: 1, standalone: 0 });
    expect(createLogFromPlanDayWithStravaInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ planDay: day, linkSource: "auto" }),
    );
    expect(storage.workouts.createWorkoutLogs).not.toHaveBeenCalled();
  });

  it("re-checks under the lock and enriches a log the athlete confirmed meanwhile", async () => {
    const day = planDay();
    const confirmed = makeWorkoutLog({ id: "log-late", planDayId: day.id, date: DATE });
    vi.mocked(storage.plans.listOpenPlanDaysForDates).mockResolvedValue([day]);
    vi.mocked(db.transaction).mockImplementation(async (callback) =>
      callback(txWithExistingLog([confirmed]) as never),
    );
    vi.mocked(attachStravaActivityToLogInTx).mockResolvedValue({
      ...confirmed,
      stravaActivityId: "9001",
    });

    const counts = await reconcileStravaActivities(USER, [item(stravaRun())], silentLog);

    expect(counts).toMatchObject({ enriched: 1, completedPlanDays: 0 });
    expect(attachStravaActivityToLogInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logId: "log-late" }),
    );
    expect(createLogFromPlanDayWithStravaInTx).not.toHaveBeenCalled();
  });

  it("falls back to a standalone import when the matched log was claimed by a concurrent sync", async () => {
    const logged = makeWorkoutLog({
      id: "log-1",
      date: DATE,
      focus: "Easy Run",
      mainWorkout: "8 km easy",
      duration: 45,
    });
    vi.mocked(storage.workouts.listDeviceUnlinkedLogsForDates).mockResolvedValue([logged]);
    vi.mocked(attachStravaActivityToLogInTx).mockResolvedValue(undefined);

    const counts = await reconcileStravaActivities(USER, [item(stravaRun())], silentLog);

    expect(counts).toMatchObject({ enriched: 0, standalone: 1 });
    const [rows] = vi.mocked(storage.workouts.createWorkoutLogs).mock.calls[0];
    expect(rows[0]).toMatchObject({ stravaActivityId: "9001", planDayId: null, source: "strava" });
    expect(rows[0].deviceActivity).toMatchObject({ provider: "strava", filledColumns: [] });
  });

  it("imports standalone with the suggested target when the match is only plausible", async () => {
    // Same-day easy run prescribed at 45 min; the recording is a 90 min run.
    vi.mocked(storage.plans.listOpenPlanDaysForDates).mockResolvedValue([
      planDay({ mainWorkout: "Easy run, 45 min" }),
    ]);

    const counts = await reconcileStravaActivities(
      USER,
      [item(stravaRun({ name: "Run", moving_time: 90 * 60, distance: 0 }))],
      silentLog,
    );

    expect(counts).toMatchObject({ suggested: 1, standalone: 0, completedPlanDays: 0 });
    const [rows] = vi.mocked(storage.workouts.createWorkoutLogs).mock.calls[0];
    expect(rows[0]).toMatchObject({ suggestedPlanDayId: "pd-1", suggestedWorkoutLogId: null });
    expect(rows[0].suggestedLinkConfidence).toBeGreaterThan(0);
    expect(createLogFromPlanDayWithStravaInTx).not.toHaveBeenCalled();
  });

  it("imports standalone, exactly as before, when the day has nothing to match", async () => {
    const counts = await reconcileStravaActivities(USER, [item(stravaRun())], silentLog);

    expect(counts).toMatchObject({ standalone: 1, suggested: 0 });
    const [rows] = vi.mocked(storage.workouts.createWorkoutLogs).mock.calls[0];
    expect(rows[0]).toMatchObject({
      stravaActivityId: "9001",
      suggestedPlanDayId: null,
      suggestedWorkoutLogId: null,
      suggestedLinkConfidence: null,
    });
  });

  it("gives a standalone import its one exercise set, so the set-derived analytics see it", async () => {
    await reconcileStravaActivities(USER, [item(stravaRun())], silentLog, {
      preferences: { weightUnit: "kg", distanceUnit: "km" },
    });

    const [setRows] = vi.mocked(storage.workouts.createDeviceActivitySets).mock.calls[0];
    expect(setRows).toHaveLength(1);
    expect(setRows[0]).toMatchObject({
      workoutLogId: "created-0",
      exerciseName: "run",
      category: "running",
      distance: 8100,
      reps: null,
      weight: null,
    });
  });

  it("writes no set for an enriched log — the athlete's own session describes itself", async () => {
    const logged = makeWorkoutLog({ id: "log-1", date: DATE, focus: "Easy Run", duration: 45 });
    vi.mocked(storage.workouts.listDeviceUnlinkedLogsForDates).mockResolvedValue([logged]);
    vi.mocked(attachStravaActivityToLogInTx).mockResolvedValue({
      ...logged,
      stravaActivityId: "9001",
    });

    const counts = await reconcileStravaActivities(USER, [item(stravaRun())], silentLog);

    expect(counts).toMatchObject({ enriched: 1, standalone: 0 });
    // Nothing was inserted standalone, so nothing reaches the set writer at all.
    expect(storage.workouts.createDeviceActivitySets).not.toHaveBeenCalled();
  });

  it("writes no set for an import whose sport the recording does not describe", async () => {
    await reconcileStravaActivities(
      USER,
      [item(stravaRun({ sport_type: "WeightTraining", type: "WeightTraining", distance: 0 }))],
      silentLog,
    );

    const [setRows] = vi.mocked(storage.workouts.createDeviceActivitySets).mock.calls[0];
    expect(setRows).toEqual([]);
  });

  it("never completes a rest day with a walk", async () => {
    vi.mocked(storage.plans.listOpenPlanDaysForDates).mockResolvedValue([
      planDay({ focus: "Rest", mainWorkout: "Full rest", expectedDurationMin: null }),
    ]);

    const counts = await reconcileStravaActivities(
      USER,
      [
        item(
          stravaRun({
            sport_type: "Walk",
            type: "Walk",
            name: "Dog walk",
            moving_time: 40 * 60,
            distance: 3000,
          }),
        ),
      ],
      silentLog,
    );

    expect(counts).toMatchObject({ standalone: 1, completedPlanDays: 0, suggested: 0 });
    expect(createLogFromPlanDayWithStravaInTx).not.toHaveBeenCalled();
  });

  it("counts rows the DB rejected on the unique index as skipped", async () => {
    vi.mocked(storage.workouts.createWorkoutLogs).mockResolvedValue([]);

    const counts = await reconcileStravaActivities(USER, [item(stravaRun())], silentLog);

    expect(counts).toMatchObject({ standalone: 0, skipped: 1 });
  });

  it("gives one row to one activity across a batch", async () => {
    const day = planDay({ focus: "Tempo Run", mainWorkout: "45 min tempo" });
    vi.mocked(storage.plans.listOpenPlanDaysForDates).mockResolvedValue([day]);
    vi.mocked(createLogFromPlanDayWithStravaInTx).mockResolvedValue(
      makeWorkoutLog({ id: "new", planDayId: day.id }),
    );

    const warmUp = stravaRun({
      id: 1,
      name: "Warm up",
      moving_time: 12 * 60,
      distance: 2000,
      start_date_local: "2026-09-08T17:00:00Z",
    });
    const tempo = stravaRun({
      id: 2,
      name: "Tempo",
      moving_time: 46 * 60,
      distance: 10_000,
      start_date_local: "2026-09-08T17:15:00Z",
    });

    const counts = await reconcileStravaActivities(USER, [item(warmUp), item(tempo)], silentLog);

    expect(counts).toMatchObject({ completedPlanDays: 1, standalone: 1 });
    expect(createLogFromPlanDayWithStravaInTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createLogFromPlanDayWithStravaInTx).mock.calls[0][1].raw.id).toBe(2);
    const [rows] = vi.mocked(storage.workouts.createWorkoutLogs).mock.calls[0];
    expect(rows.map((r) => r.stravaActivityId)).toEqual(["1"]);
  });
});
