import type { StravaActivitySummary, WorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import { db } from "../db";
import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";
import {
  attachStravaActivityToLogInTx,
  createLogFromPlanDayWithStravaInTx,
  dismissDeviceLinkSuggestion,
  hasAthleteEdits,
  legacyRawFromLog,
  type LinkCreatedLogContents,
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
const streamMocks = vi.hoisted(() => ({ deleteForLog: vi.fn() }));
const planMocks = vi.hoisted(() => ({ getPlanDay: vi.fn() }));
vi.mock("../storage", () => ({
  storage: {
    plans: { getPlanDay: planMocks.getPlanDay },
    sessionStreams: { deleteForLog: streamMocks.deleteForLog },
  },
}));
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

/** The plan day the link-created fixtures below were built from. */
const LINK_PLAN_DAY = createMockPlanDay({
  id: "pd-1",
  focus: "Strength",
  scheduledDate: "2026-09-08",
});

/** A set as copyPrescribedSetsIntoLog writes it: actuals equal to the prescription. */
const UNTOUCHED_SET = {
  version: 1,
  reps: 5,
  plannedReps: 5,
  weight: 100,
  plannedWeight: 100,
  distance: null,
  plannedDistance: null,
  time: null,
  plannedTime: null,
} as const;

/**
 * A plan-day log exactly as createLogFromPlanDayWithStravaInTx leaves it: the
 * prescription's text (snapshotted into prescribed*), the recording's
 * metrics, one copied set counted by the adherence snapshot.
 */
function linkCreatedLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return makeWorkoutLog({
    id: "log-2",
    source: "strava",
    date: "2026-09-08",
    focus: "Strength",
    mainWorkout: "Back squat 5x5 @ 100kg",
    prescribedMainWorkout: "Back squat 5x5 @ 100kg",
    notes: "Back squat 5x5\nStrava: Morning Run",
    prescribedNotes: "Back squat 5x5\nStrava: Morning Run",
    plannedSetCount: 1,
    actualSetCount: 1,
    planDayId: "pd-1",
    planId: "plan-1",
    duration: 45,
    distanceMeters: 8100,
    startedAt: new Date("2026-09-08T11:30:00Z"),
    stravaActivityId: "9001",
    deviceLinkSource: "auto",
    deviceLinkConfidence: 0.8,
    deviceActivity: {
      provider: "strava",
      raw: RAW,
      filledColumns: ["duration", "distanceMeters", "startedAt"],
      linkedAt: "2026-09-08T12:00:00Z",
    },
    ...overrides,
  });
}

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

/** The first argument of a transaction builder's first call, e.g. the patch the first `.set()` wrote. */
function firstCallArg(builderMock: Mock): Record<string, unknown> {
  const call = builderMock.mock.calls.at(0);
  if (!call) throw new Error("The transaction builder was never called.");
  return call[0] as Record<string, unknown>;
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

  /** Attach a recording the athlete rated 6 on Strava to a log with `logRpe`; returns the UPDATE patch. */
  async function attachRatedRecording(logRpe: number | null) {
    const tx = makeTx();
    const existing = makeWorkoutLog({ id: "log-1", rpe: logRpe });
    tx.for.mockResolvedValue([existing]);
    tx.returning.mockResolvedValue([{ ...existing, stravaActivityId: "9001" }]);
    await attachStravaActivityToLogInTx(tx as never, {
      logId: "log-1",
      userId: USER,
      raw: RAW,
      metrics: { ...pickDeviceMetrics(mapStravaActivityToWorkout(RAW, USER, "km")), rpe: 6 },
      linkSource: "auto",
      confidence: 0.9,
    });
    return tx.set.mock.calls[0][0];
  }

  it("fills an empty RPE from the athlete's Strava rating and records it for unlink", async () => {
    const patch = await attachRatedRecording(null);
    expect(patch.rpe).toBe(6);
    expect(patch.deviceActivity.filledColumns).toContain("rpe");
  });

  it("never replaces an RPE the athlete gave with the one they gave on Strava", async () => {
    const patch = await attachRatedRecording(8);
    expect(patch.rpe).toBeUndefined();
    expect(patch.deviceActivity.filledColumns).not.toContain("rpe");
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

describe("createLogFromPlanDayWithStravaInTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createWorkoutInTx).mockResolvedValue(makeWorkoutLog({ id: "created" }));
  });

  const planDay = createMockPlanDay({ id: "pd-1", scheduledDate: "2026-09-08", focus: "Tempo" });
  const metrics = pickDeviceMetrics(mapStravaActivityToWorkout(RAW, USER, "km"));

  /** Complete the plan day from a recording rated `rpe` on Strava; returns the new log's payload. */
  async function completeDayWith(rpe: number | null) {
    await createLogFromPlanDayWithStravaInTx(makeTx() as never, {
      userId: USER,
      planDay,
      raw: RAW,
      metrics: { ...metrics, rpe },
      linkSource: "auto",
      confidence: 0.9,
    });
    return vi.mocked(createWorkoutInTx).mock.calls[0][1];
  }

  it("gives the day's new log the athlete's Strava rating", async () => {
    const payload = await completeDayWith(7);
    expect(payload).toMatchObject({ planDayId: "pd-1", rpe: 7 });
    expect(payload.deviceActivity?.filledColumns).toContain("rpe");
  });

  it("leaves the RPE empty when the athlete gave no rating: a watch cannot tell how it felt", async () => {
    const payload = await completeDayWith(null);
    expect(payload.rpe).toBeNull();
    expect(payload.deviceActivity?.filledColumns).not.toContain("rpe");
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
    // The kept log loses the recording's stream with it, inside the same transaction.
    expect(streamMocks.deleteForLog).toHaveBeenCalledWith("log-1", USER, tx);
  });

  /**
   * Queue the reads unlink makes of a plan-day log the link created, in order:
   * the log itself (FOR UPDATE), its sets, its scored structure blocks.
   */
  function givenLinkCreatedLog(log: WorkoutLog, contents: Partial<LinkCreatedLogContents> = {}) {
    const { planDay = LINK_PLAN_DAY, sets = [UNTOUCHED_SET], scoredBlocks = 0 } = contents;
    tx.for.mockResolvedValue([log]);
    planMocks.getPlanDay.mockResolvedValue(planDay);
    tx.where
      .mockReturnValueOnce(tx) // the log select, finished by .for()
      .mockResolvedValueOnce(sets)
      .mockResolvedValueOnce(Array.from({ length: scoredBlocks }, (_, i) => ({ id: `b-${i}` })));
  }

  it("deletes a plan-day log the sync created and re-derives the day's status", async () => {
    givenLinkCreatedLog(linkCreatedLog());
    tx.where.mockResolvedValueOnce({ rowCount: 1 }); // the delete
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

  it("keeps a plan-day log the sync created once the athlete has logged on it, as their own log", async () => {
    // D11 (CODEBASE_ANALYSIS_2026-10-03): the athlete entered the weights they
    // lifted, an RPE and a note on the day's log, then unlinked a wrong match.
    // Deleting the log took all of it with it, with nothing in the bin.
    const edited = linkCreatedLog({
      rpe: 8,
      notes: "Back squat 5x5\nStrava: Morning Run\nFelt heavy today",
    });
    givenLinkCreatedLog(edited, {
      sets: [{ ...UNTOUCHED_SET, weight: 102.5, version: 2 }],
    });
    tx.returning
      .mockResolvedValueOnce([{ ...edited, source: "manual", stravaActivityId: null }])
      .mockResolvedValueOnce([
        makeWorkoutLog({ id: "standalone", stravaActivityId: "9001", source: "strava" }),
      ]);

    const result = await unlinkDeviceActivity({ userId: USER, logId: "log-2", distanceUnit: "km" });

    expect(tx.delete).not.toHaveBeenCalled();
    expect(syncPlanDayStatusFromWorkouts).not.toHaveBeenCalled();
    const patch = firstCallArg(tx.set);
    expect(patch).toEqual({
      duration: null,
      distanceMeters: null,
      startedAt: null,
      source: "manual",
      notes: "Back squat 5x5\nFelt heavy today",
      prescribedNotes: "Back squat 5x5",
      stravaActivityId: null,
      deviceLinkSource: null,
      deviceLinkConfidence: null,
      deviceActivity: null,
    });
    // Their RPE was never the recording's, so it neither leaves the log nor
    // travels with the recording.
    expect(patch.rpe).toBeUndefined();
    expect(firstCallArg(tx.values).rpe).toBeNull();
    expect(streamMocks.deleteForLog).toHaveBeenCalledWith("log-2", USER, tx);
    expect(result.log?.source).toBe("manual");
    expect(result.standalone.id).toBe("standalone");
  });

  it("refuses a log with nothing linked", async () => {
    tx.for.mockResolvedValue([makeWorkoutLog({ id: "log-3" })]);
    await expect(
      unlinkDeviceActivity({ userId: USER, logId: "log-3", distanceUnit: "km" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("hasAthleteEdits", () => {
  const untouched: LinkCreatedLogContents = {
    planDay: LINK_PLAN_DAY,
    sets: [UNTOUCHED_SET],
    scoredBlocks: 0,
  };

  it("finds nothing on a log that is still exactly what the link built", () => {
    expect(hasAthleteEdits(linkCreatedLog(), untouched)).toBe(false);
  });

  it("counts a Strava rating the link filled as the recording's, not the athlete's", () => {
    const rated = linkCreatedLog({
      rpe: 6,
      deviceActivity: {
        provider: "strava",
        raw: RAW,
        filledColumns: ["duration", "distanceMeters", "startedAt", "rpe"],
        linkedAt: "2026-09-08T12:00:00Z",
      },
    });
    expect(hasAthleteEdits(rated, untouched)).toBe(false);
  });

  it.each<[string, Partial<WorkoutLog>]>([
    ["an RPE", { rpe: 8 }],
    ["notes", { notes: "Back squat 5x5\nStrava: Morning Run\nLeft knee niggle" }],
    ["a rewritten description", { mainWorkout: "Back squat 5x5 @ 105kg" }],
    ["an accessory", { accessory: "Core finisher" }],
    ["a heart rate the recording lacked", { avgHeartrate: 140 }],
    ["a start time", { timeOfDayMin: 420 }],
    ["a not-training flag", { countsAsTraining: false }],
    ["a new title", { focus: "Heavy squats" }],
    ["a moved date", { date: "2026-09-09" }],
  ])("sees %s typed on the log", (_label, edit) => {
    expect(hasAthleteEdits(linkCreatedLog(edit), untouched)).toBe(true);
  });

  it.each<[string, Partial<LinkCreatedLogContents>]>([
    ["an edited set", { sets: [{ ...UNTOUCHED_SET, version: 2 }] }],
    ["an actual that differs from the prescription", { sets: [{ ...UNTOUCHED_SET, reps: 4 }] }],
    ["a removed set", { sets: [] }],
    ["an added set", { sets: [UNTOUCHED_SET, { ...UNTOUCHED_SET, plannedReps: null }] }],
    ["a block score", { scoredBlocks: 1 }],
    ["a plan day it can no longer be checked against", { planDay: undefined }],
  ])("sees %s", (_label, contents) => {
    expect(hasAthleteEdits(linkCreatedLog(), { ...untouched, ...contents })).toBe(true);
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

  it("brings the import's rating along to a log that has none", async () => {
    // The import's RPE (the athlete's Strava rating, or one they gave the
    // import here) would otherwise go with the deleted row.
    const standalone = makeWorkoutLog({
      id: "import-1",
      source: "strava",
      stravaActivityId: "9001",
      rpe: 7,
      deviceActivity: { provider: "strava", raw: RAW, filledColumns: [], linkedAt: "2026-09-08T12:00:00Z" },
    });
    const target = makeWorkoutLog({ id: "log-1", rpe: null });
    tx.for.mockResolvedValueOnce([standalone]).mockResolvedValueOnce([target]);
    tx.where.mockReturnValueOnce(tx);
    tx.where.mockResolvedValueOnce({ rowCount: 1 });
    tx.returning.mockResolvedValueOnce([{ ...target, stravaActivityId: "9001", rpe: 7 }]);

    await linkStandaloneDeviceLog({ userId: USER, deviceLogId: "import-1", target: { workoutLogId: "log-1" } });

    const [patch] = tx.set.mock.calls[0];
    expect(patch.rpe).toBe(7);
    // Recorded as filled, so an unlink hands it back to the recording.
    expect(patch.deviceActivity.filledColumns).toContain("rpe");
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

  function linkedLog(rpe: number, filledColumns: string[]): WorkoutLog {
    return makeWorkoutLog({
      id: "log-9",
      source: "strava",
      planDayId: "pd-1",
      stravaActivityId: "9001",
      rpe,
      deviceActivity: { provider: "strava", raw: RAW, filledColumns, linkedAt: "2026-09-08T12:00:00Z" },
    });
  }

  /** Release `log`'s recording; returns the standalone row it inserted. */
  async function releasedRow(log: WorkoutLog) {
    const tx = makeTx();
    tx.returning.mockResolvedValueOnce([makeWorkoutLog({ id: "standalone" })]);
    await releaseStravaActivityInTx(tx as never, log, USER, "km");
    return tx.values.mock.calls[0][0];
  }

  it("takes a Strava rating the link filled along with the recording", async () => {
    expect((await releasedRow(linkedLog(6, ["duration", "rpe"]))).rpe).toBe(6);
  });

  it("leaves behind a rating the log had before the link", async () => {
    expect((await releasedRow(linkedLog(8, ["duration"]))).rpe).toBeNull();
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
