import type { StravaActivitySummary, WorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";
import {
  attachStravaActivityToLogInTx,
  dismissDeviceLinkSuggestion,
  legacyRawFromLog,
  linkStandaloneDeviceLog,
  pickDeviceMetrics,
  releaseStravaActivityInTx,
  stripStravaActivityLabel,
  unlinkDeviceActivity,
} from "./deviceActivityLink";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";
import { createWorkoutInTx } from "./workoutService";

vi.mock("../db", () => ({ db: { transaction: vi.fn(), update: vi.fn() } }));
vi.mock("../storage", () => ({ storage: { plans: { getPlanDay: vi.fn() } } }));
vi.mock("../storage/planDayStatus", () => ({ syncPlanDayStatusFromWorkouts: vi.fn() }));
vi.mock("./workoutService", () => ({ createWorkoutInTx: vi.fn() }));

const USER = "user-1";

const RAW: StravaActivitySummary = {
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
};

function makeTx() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    for: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };
}

describe("attachStravaActivityToLogInTx", () => {
  it("fills only the NULL metric columns and records which ones", async () => {
    const tx = makeTx();
    // The athlete typed a duration and an RPE; distance and HR were left blank.
    const existing = makeWorkoutLog({ id: "log-1", duration: 50, rpe: 7 });
    tx.for.mockResolvedValue([existing]);
    tx.returning.mockResolvedValue([{ ...existing, stravaActivityId: "9001" }]);

    const metrics = pickDeviceMetrics(mapStravaActivityToWorkout(RAW, USER, "km"));
    const result = await attachStravaActivityToLogInTx(tx as never, {
      logId: "log-1",
      userId: USER,
      raw: RAW,
      metrics,
      linkSource: "auto",
      confidence: 0.91,
    });

    expect(result?.stravaActivityId).toBe("9001");
    const [patch] = tx.set.mock.calls[0];
    expect(patch.duration).toBeUndefined();
    expect(patch.rpe).toBeUndefined();
    expect(patch).toMatchObject({
      distanceMeters: 8100,
      avgHeartrate: 152,
      maxHeartrate: 171,
      elevationGain: 40,
      stravaActivityId: "9001",
      deviceLinkSource: "auto",
      deviceLinkConfidence: 0.91,
      suggestedPlanDayId: null,
      suggestedWorkoutLogId: null,
      suggestedLinkConfidence: null,
    });
    expect(patch.deviceActivity.filledColumns).not.toContain("duration");
    expect(patch.deviceActivity.filledColumns).toEqual(
      expect.arrayContaining(["distanceMeters", "avgHeartrate", "maxHeartrate", "startedAt"]),
    );
    expect(patch.deviceActivity.raw).toEqual(RAW);
  });

  it("returns undefined when the row already carries a device activity", async () => {
    const tx = makeTx();
    tx.for.mockResolvedValue([]);
    const result = await attachStravaActivityToLogInTx(tx as never, {
      logId: "log-1",
      userId: USER,
      raw: RAW,
      metrics: pickDeviceMetrics({}),
      linkSource: "auto",
      confidence: 0.9,
    });
    expect(result).toBeUndefined();
    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe("unlinkDeviceActivity", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    vi.mocked(db.transaction).mockImplementation(async (callback) => callback(tx as never));
  });

  it("strips exactly the filled columns from the athlete's own log and re-creates the activity", async () => {
    const linked = makeWorkoutLog({
      id: "log-1",
      source: "manual",
      duration: 50,
      rpe: 7,
      distanceMeters: 8100,
      avgHeartrate: 152,
      calories: 610,
      stravaActivityId: "9001",
      deviceLinkSource: "auto",
      deviceLinkConfidence: 0.9,
      deviceActivity: {
        provider: "strava",
        raw: RAW,
        filledColumns: ["distanceMeters", "avgHeartrate", "calories"],
        linkedAt: "2026-09-08T12:00:00Z",
      },
    });
    tx.for.mockResolvedValue([linked]);
    tx.returning
      .mockResolvedValueOnce([{ ...linked, stravaActivityId: null, distanceMeters: null }])
      .mockResolvedValueOnce([
        makeWorkoutLog({ id: "standalone", stravaActivityId: "9001", source: "strava" }),
      ]);

    const result = await unlinkDeviceActivity({ userId: USER, logId: "log-1", distanceUnit: "km" });

    const [patch] = tx.set.mock.calls[0];
    expect(patch).toEqual({
      distanceMeters: null,
      avgHeartrate: null,
      calories: null,
      stravaActivityId: null,
      deviceLinkSource: null,
      deviceLinkConfidence: null,
      deviceActivity: null,
    });
    expect(tx.delete).not.toHaveBeenCalled();

    const [inserted] = tx.values.mock.calls[0];
    expect(inserted).toMatchObject({
      userId: USER,
      source: "strava",
      stravaActivityId: "9001",
      planDayId: null,
      calories: 610,
    });
    expect(inserted.deviceActivity).toMatchObject({ provider: "strava", filledColumns: [] });
    expect(result.log?.stravaActivityId).toBeNull();
    expect(result.standalone.id).toBe("standalone");
  });

  it("deletes a plan-day log the sync created and re-derives the day's status", async () => {
    const created = makeWorkoutLog({
      id: "log-2",
      source: "strava",
      planDayId: "pd-1",
      stravaActivityId: "9001",
      deviceLinkSource: "auto",
      deviceActivity: {
        provider: "strava",
        raw: RAW,
        filledColumns: ["duration", "distanceMeters"],
        linkedAt: "2026-09-08T12:00:00Z",
      },
    });
    tx.for.mockResolvedValue([created]);
    tx.where.mockReturnValueOnce(tx).mockResolvedValueOnce({ rowCount: 1 });
    tx.returning.mockResolvedValueOnce([
      makeWorkoutLog({ id: "standalone", stravaActivityId: "9001", source: "strava" }),
    ]);

    const result = await unlinkDeviceActivity({ userId: USER, logId: "log-2", distanceUnit: "km" });

    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("pd-1", USER, tx);
    expect(tx.update).not.toHaveBeenCalled();
    expect(result.log).toBeNull();
    expect(result.standalone.id).toBe("standalone");
  });

  it("refuses a log with nothing linked", async () => {
    tx.for.mockResolvedValue([makeWorkoutLog({ id: "log-3" })]);
    await expect(
      unlinkDeviceActivity({ userId: USER, logId: "log-3", distanceUnit: "km" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("linkStandaloneDeviceLog", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    vi.mocked(db.transaction).mockImplementation(async (callback) => callback(tx as never));
  });

  it("merges a standalone import into the athlete's log as a manual link and removes the import", async () => {
    const standalone = makeWorkoutLog({
      id: "import-1",
      source: "strava",
      stravaActivityId: "9001",
      distanceMeters: 8100,
      duration: 45,
      deviceActivity: {
        provider: "strava",
        raw: RAW,
        filledColumns: [],
        linkedAt: "2026-09-08T12:00:00Z",
      },
    });
    const target = makeWorkoutLog({ id: "log-1", rpe: 6 });
    // 1st FOR UPDATE: the standalone row; 2nd (inside attach): the target.
    tx.for.mockResolvedValueOnce([standalone]).mockResolvedValueOnce([target]);
    tx.where.mockReturnValueOnce(tx); // select chain
    tx.where.mockResolvedValueOnce({ rowCount: 1 }); // delete of the import
    tx.returning.mockResolvedValueOnce([
      { ...target, stravaActivityId: "9001", deviceLinkSource: "manual" },
    ]);

    const result = await linkStandaloneDeviceLog({
      userId: USER,
      deviceLogId: "import-1",
      target: { workoutLogId: "log-1" },
    });

    expect(result.deviceLinkSource).toBe("manual");
    expect(tx.delete).toHaveBeenCalledTimes(1);
    const [patch] = tx.set.mock.calls[0];
    expect(patch).toMatchObject({
      deviceLinkSource: "manual",
      deviceLinkConfidence: null,
      distanceMeters: 8100,
      duration: 45,
    });
    expect(createWorkoutInTx).not.toHaveBeenCalled();
  });

  it("refuses to move a recording that is already someone's log", async () => {
    tx.for.mockResolvedValueOnce([
      makeWorkoutLog({ id: "log-1", stravaActivityId: "9001", deviceLinkSource: "auto" }),
    ]);
    await expect(
      linkStandaloneDeviceLog({
        userId: USER,
        deviceLogId: "log-1",
        target: { workoutLogId: "log-2" },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.delete).not.toHaveBeenCalled();
  });
});

describe("releaseStravaActivityInTx", () => {
  it("rebuilds the standalone row from a log imported before the snapshot column existed", async () => {
    const tx = makeTx();
    tx.returning.mockResolvedValueOnce([
      makeWorkoutLog({ id: "standalone", stravaActivityId: "9001", source: "strava" }),
    ]);
    const legacy = makeWorkoutLog({
      id: "log-9",
      source: "strava",
      planDayId: "pd-1",
      stravaActivityId: "9001",
      focus: "Run",
      notes: "Morning Run | Avg HR: 152 bpm",
      distanceMeters: 8100,
      duration: 45,
      deviceActivity: null,
    });

    const standalone = await releaseStravaActivityInTx(tx as never, legacy, USER, "km");

    const [inserted] = tx.values.mock.calls[0];
    expect(inserted).toMatchObject({
      userId: USER,
      source: "strava",
      stravaActivityId: "9001",
      planDayId: null,
      distanceMeters: 8100,
    });
    expect(inserted.deviceActivity).toMatchObject({
      provider: "strava",
      filledColumns: [],
      raw: { id: 9001, name: "Morning Run" },
    });
    expect(standalone.id).toBe("standalone");
  });
});

describe("stripStravaActivityLabel", () => {
  const linked = makeWorkoutLog({
    deviceActivity: { provider: "strava", raw: RAW, filledColumns: [], linkedAt: "2026-09-08T12:00:00Z" },
  });

  it("drops exactly the label line the sync appended", () => {
    expect(stripStravaActivityLabel("Keep it easy\nStrava: Morning Run", linked)).toBe("Keep it easy");
  });

  it("returns null when the label was the only line", () => {
    expect(stripStravaActivityLabel("Strava: Morning Run", linked)).toBeNull();
  });

  it("leaves the notes alone without a snapshot to name the activity", () => {
    const legacy = makeWorkoutLog({ deviceActivity: null });
    expect(stripStravaActivityLabel("Strava: Morning Run", legacy)).toBe("Strava: Morning Run");
    expect(stripStravaActivityLabel(null, linked)).toBeNull();
  });
});

describe("dismissDeviceLinkSuggestion", () => {
  function dbUpdateChain(returning: WorkoutLog[]) {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue(returning),
    };
    vi.mocked(db.update).mockReturnValue(chain as never);
    return chain;
  }

  it("clears only the suggestion columns on the athlete's own row", async () => {
    const cleared = makeWorkoutLog({ id: "import-1", stravaActivityId: "9001", source: "strava" });
    const chain = dbUpdateChain([cleared]);

    const result = await dismissDeviceLinkSuggestion({ userId: USER, logId: "import-1" });

    expect(result).toBe(cleared);
    expect(chain.set).toHaveBeenCalledWith({
      suggestedPlanDayId: null,
      suggestedWorkoutLogId: null,
      suggestedLinkConfidence: null,
    });
  });

  it("404s when the row is missing or belongs to someone else", async () => {
    dbUpdateChain([]);
    await expect(
      dismissDeviceLinkSuggestion({ userId: USER, logId: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("legacyRawFromLog", () => {
  it("rebuilds a usable activity from a pre-snapshot standalone import", () => {
    const legacy = makeWorkoutLog({
      focus: "Run",
      notes: "Evening Run | Avg HR: 150 bpm (max 170)",
      stravaActivityId: "42",
      duration: 30,
      distanceMeters: 5000,
      avgHeartrate: 150,
      maxHeartrate: 170,
      date: "2026-09-01",
    });
    expect(legacyRawFromLog(legacy)).toMatchObject({
      id: 42,
      name: "Evening Run",
      sport_type: "Run",
      moving_time: 1800,
      distance: 5000,
      average_heartrate: 150,
      start_date_local: "2026-09-01T00:00:00Z",
    });
  });
});

// Keep the fixture helper referenced so the file reads as a unit on its own.
void (null as unknown as WorkoutLog);
