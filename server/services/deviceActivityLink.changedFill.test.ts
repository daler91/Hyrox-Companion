import type { StravaActivitySummary, WorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import { db } from "../db";
import {
  attachStravaActivityToLogInTx,
  hasAthleteEdits,
  type LinkCreatedLogContents,
  pickDeviceMetrics,
  stravaSnapshot,
  unlinkDeviceActivity,
} from "./deviceActivityLink";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";

/**
 * D40 (CODEBASE_ANALYSIS_2026-10-03): unlink nulled every column the link had
 * filled, even one the athlete changed since. An RPE they moved from Strava's
 * 6 to 8 left their log and went to the released recording's row. A link now
 * records the value it wrote into each column it filled, and unlink returns
 * a column to NULL only while it still holds that value. The rest of the
 * link and unlink behaviour is in deviceActivityLink.test.ts.
 */

vi.mock("../db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("../storage", () => ({
  storage: {
    plans: { getPlanDay: vi.fn() },
    sessionStreams: { deleteForLog: vi.fn() },
  },
}));
vi.mock("../storage/planDayStatus", () => ({ syncPlanDayStatusFromWorkouts: vi.fn() }));
vi.mock("./workoutService", () => ({ createWorkoutInTx: vi.fn() }));

const ATHLETE_ID = "user-1";

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
    for: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
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
  it("records the value it wrote into each column it filled, and only those", async () => {
    const tx = makeTx();
    const existing = makeWorkoutLog({ id: "log-1", duration: 50 });
    tx.for.mockResolvedValue([existing]);
    tx.returning.mockResolvedValue([{ ...existing, stravaActivityId: "9001" }]);

    await attachStravaActivityToLogInTx(tx as never, {
      logId: "log-1",
      userId: ATHLETE_ID,
      raw: RAW,
      metrics: { ...pickDeviceMetrics(mapStravaActivityToWorkout(RAW, ATHLETE_ID, "km")), rpe: 6 },
      linkSource: "auto",
      confidence: 0.9,
    });

    const { deviceActivity } = firstCallArg(tx.set) as {
      deviceActivity: { filledColumns: string[]; filledValues: Record<string, unknown> };
    };
    expect(deviceActivity.filledValues).toMatchObject({
      rpe: 6,
      distanceMeters: 8100,
      avgHeartrate: 152,
    });
    // The athlete's own duration was not filled, so nothing is recorded for it.
    expect(deviceActivity.filledValues).not.toHaveProperty("duration");
    expect(Object.keys(deviceActivity.filledValues).sort()).toEqual(
      [...deviceActivity.filledColumns].sort(),
    );
  });
});

describe("unlinkDeviceActivity", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    vi.mocked(db.transaction).mockImplementation((callback) => callback(tx as never));
  });

  /** Queue an unlink of `linked`, the athlete's own log a link enriched with RAW. */
  function givenOwnLinkedLog(overrides: Partial<WorkoutLog>) {
    const linked = makeWorkoutLog({
      id: "log-1",
      source: "manual",
      stravaActivityId: "9001",
      deviceLinkSource: "auto",
      deviceLinkConfidence: 0.9,
      ...overrides,
    });
    tx.for.mockResolvedValue([linked]);
    tx.returning
      .mockResolvedValueOnce([{ ...linked, stravaActivityId: null }])
      .mockResolvedValueOnce([
        makeWorkoutLog({ id: "standalone", stravaActivityId: "9001", source: "strava" }),
      ]);
  }

  it("keeps a value the athlete typed over a filled column on their log, and gives the recording its own", async () => {
    givenOwnLinkedLog({
      rpe: 8,
      distanceMeters: 8100,
      deviceActivity: stravaSnapshot(RAW, ["distanceMeters", "rpe"], {
        distanceMeters: 8100,
        rpe: 6,
      }),
    });

    await unlinkDeviceActivity({ userId: ATHLETE_ID, logId: "log-1", distanceUnit: "km" });

    expect(firstCallArg(tx.set)).toEqual({
      distanceMeters: null,
      stravaActivityId: null,
      deviceLinkSource: null,
      deviceLinkConfidence: null,
      deviceActivity: null,
    });
    expect(firstCallArg(tx.values)).toMatchObject({ stravaActivityId: "9001", rpe: 6 });
  });

  it("unwinds a link made before links recorded their values as it always did", async () => {
    // Nothing recorded to tell an edit by, and today's mapper output is no
    // stand-in (it has changed since), so every filled column goes back.
    givenOwnLinkedLog({
      duration: 50,
      distanceMeters: 8100,
      deviceActivity: {
        provider: "strava",
        raw: RAW,
        filledColumns: ["duration", "distanceMeters"],
        linkedAt: "2026-09-08T12:00:00Z",
      },
    });

    await unlinkDeviceActivity({ userId: ATHLETE_ID, logId: "log-1", distanceUnit: "km" });

    expect(firstCallArg(tx.set)).toMatchObject({
      duration: null,
      distanceMeters: null,
      stravaActivityId: null,
    });
  });

  it("still hands over a rating a link made before links recorded their values", async () => {
    givenOwnLinkedLog({
      rpe: 6,
      deviceActivity: {
        provider: "strava",
        raw: RAW,
        filledColumns: ["rpe"],
        linkedAt: "2026-09-08T12:00:00Z",
      },
    });

    await unlinkDeviceActivity({ userId: ATHLETE_ID, logId: "log-1", distanceUnit: "km" });

    expect(firstCallArg(tx.set)).toMatchObject({ rpe: null });
    expect(firstCallArg(tx.values)).toMatchObject({ rpe: 6 });
  });
});

describe("hasAthleteEdits", () => {
  /** A plan-day log a link created from RAW that still holds what the link wrote. */
  function linkCreatedLog(overrides: Partial<WorkoutLog>): WorkoutLog {
    return makeWorkoutLog({
      id: "log-2",
      source: "strava",
      date: "2026-09-08",
      focus: "Easy run",
      mainWorkout: "8 km easy",
      prescribedMainWorkout: "8 km easy",
      notes: "Strava: Morning Run",
      prescribedNotes: "Strava: Morning Run",
      plannedSetCount: 0,
      planDayId: "pd-1",
      duration: 45,
      distanceMeters: 8100,
      startedAt: new Date("2026-09-08T11:30:00Z"),
      stravaActivityId: "9001",
      deviceLinkSource: "manual",
      ...overrides,
    });
  }

  const untouched: LinkCreatedLogContents = {
    planDay: createMockPlanDay({ id: "pd-1", focus: "Easy run", scheduledDate: "2026-09-08" }),
    sets: [],
    blocks: 0,
    scoredBlocks: 0,
  };

  it("sees a value the recording filled that the athlete changed", () => {
    // The start instant comes back from the jsonb snapshot as a string.
    const filled = stravaSnapshot(RAW, ["duration", "distanceMeters", "startedAt", "rpe"], {
      duration: 45,
      distanceMeters: 8100,
      startedAt: "2026-09-08T11:30:00.000Z",
      rpe: 6,
    });
    expect(hasAthleteEdits(linkCreatedLog({ rpe: 6, deviceActivity: filled }), untouched)).toBe(
      false,
    );
    expect(hasAthleteEdits(linkCreatedLog({ rpe: 8, deviceActivity: filled }), untouched)).toBe(
      true,
    );
  });

  it("reads no filled column as changed on a link made before links recorded their values", () => {
    // RAW's run cadence would be doubled by today's mapper (C9), not by the
    // athlete: read against it, every older run link would look edited.
    const legacy = {
      provider: "strava" as const,
      raw: { ...RAW, average_cadence: 85 },
      filledColumns: ["duration", "distanceMeters", "startedAt", "avgCadence"],
      linkedAt: "2026-09-08T12:00:00Z",
    };
    expect(
      hasAthleteEdits(linkCreatedLog({ avgCadence: 85, deviceActivity: legacy }), untouched),
    ).toBe(false);
  });
});
