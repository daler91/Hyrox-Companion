import type { StravaActivitySummary } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import {
  dropCrossProviderDuplicates,
  isSameRecording,
  type RecordingTiming,
  recordingTimingFromLog,
  recordingTimingFromStrava,
} from "./crossProviderDuplicates";
import { mapGarminActivityToWorkout } from "./garminMapper";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";

vi.mock("../storage", () => ({
  storage: { workouts: { listDeviceRecordingsForDates: vi.fn() } },
}));

const USER = "user-1";
const START = Date.parse("2026-09-08T11:30:00Z");
const MIN = 60 * 1000;

function timing(overrides: Partial<RecordingTiming> = {}): RecordingTiming {
  return { startMs: START, movingTimeSec: 45 * 60, sportType: "Run", ...overrides };
}

/** The Strava list row for the run a Garmin watch recorded and auto-uploaded. */
function stravaRun(overrides: Partial<StravaActivitySummary> = {}): StravaActivitySummary {
  return {
    id: 9001,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-09-08T11:30:00Z",
    start_date_local: "2026-09-08T06:30:00Z",
    distance: 8100,
    moving_time: 45 * 60 + 20,
    elapsed_time: 46 * 60,
    total_elevation_gain: 40,
    average_speed: 3.0,
    max_speed: 4.1,
    ...overrides,
  };
}

/** The same run as the Garmin sync maps it. */
function garminRow(overrides: { startTimeGMT?: string; movingDuration?: number; typeKey?: string } = {}) {
  return mapGarminActivityToWorkout(
    {
      activityId: 555,
      activityName: "Morning Run",
      startTimeLocal: "2026-09-08 06:30:00",
      startTimeGMT: overrides.startTimeGMT ?? "2026-09-08 11:30:00",
      activityType: { typeKey: overrides.typeKey ?? "running" },
      distance: 8100,
      movingDuration: overrides.movingDuration ?? 45 * 60,
    },
    USER,
  );
}

/** That Garmin import as the storage read returns it. */
function storedGarminRow() {
  const { startedAt, duration, focus } = garminRow();
  return { startedAt, duration, focus, deviceActivity: null };
}

describe("isSameRecording", () => {
  it("matches a Garmin import and the Strava upload of the same run", () => {
    expect(
      isSameRecording(recordingTimingFromStrava(stravaRun()), recordingTimingFromLog(garminRow())),
    ).toBe(true);
  });

  it("tolerates two devices started a minute apart and moving times that differ a little", () => {
    expect(isSameRecording(timing(), timing({ startMs: START + 90_000, movingTimeSec: 43 * 60 }))).toBe(
      true,
    );
  });

  it("keeps sessions that started more than two minutes apart", () => {
    expect(isSameRecording(timing(), timing({ startMs: START + 3 * MIN }))).toBe(false);
  });

  it("keeps a short recording apart from a long one started at the same moment", () => {
    // A mis-tapped 1-minute "run" before the real one, or one leg of a
    // multisport file against the whole thing.
    expect(isSameRecording(timing(), timing({ movingTimeSec: 60 }))).toBe(false);
    expect(isSameRecording(timing({ movingTimeSec: 3 * 3600 }), timing({ movingTimeSec: 1800 }))).toBe(
      false,
    );
  });

  it("keeps plainly different sports apart but lets a generic type through", () => {
    expect(isSameRecording(timing(), timing({ sportType: "cycling" }))).toBe(false);
    expect(isSameRecording(timing(), timing({ sportType: "Workout" }))).toBe(true);
    expect(isSameRecording(timing({ sportType: "strength_training" }), timing({ sportType: "WeightTraining" }))).toBe(
      true,
    );
  });

  it("never matches a recording it cannot time", () => {
    expect(isSameRecording(timing({ startMs: null }), timing())).toBe(false);
    expect(isSameRecording(timing(), timing({ movingTimeSec: 0 }))).toBe(false);
    expect(isSameRecording(timing({ movingTimeSec: null }), timing({ movingTimeSec: null }))).toBe(false);
  });
});

describe("recordingTimingFromLog", () => {
  it("reads a Strava row's recording from its snapshot, not the duration the athlete typed", () => {
    const enriched = makeWorkoutLog({
      duration: 60,
      startedAt: null,
      focus: "Tempo",
      deviceActivity: { provider: "strava", raw: stravaRun(), filledColumns: [], linkedAt: "x" },
    });
    expect(recordingTimingFromLog(enriched)).toEqual({
      startMs: START,
      movingTimeSec: 45 * 60 + 20,
      sportType: "Run",
    });
  });

  it("falls back to the columns on a Garmin row", () => {
    expect(recordingTimingFromLog(garminRow())).toEqual({
      startMs: START,
      movingTimeSec: 45 * 60,
      sportType: "running",
    });
  });
});

describe("dropCrossProviderDuplicates", () => {
  const describeRun = (a: StravaActivitySummary) => ({
    date: a.start_date_local.split("T")[0],
    timing: recordingTimingFromStrava(a),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops what the other provider already imported and keeps the rest", async () => {
    vi.mocked(storage.workouts.listDeviceRecordingsForDates).mockResolvedValue([storedGarminRow()]);
    const duplicate = stravaRun();
    const evening = stravaRun({ id: 9002, start_date: "2026-09-08T22:00:00Z" });

    const result = await dropCrossProviderDuplicates(USER, [duplicate, evening], "garmin", describeRun);

    expect(result).toEqual({ kept: [evening], duplicates: 1 });
    expect(storage.workouts.listDeviceRecordingsForDates).toHaveBeenCalledWith(
      USER,
      ["2026-09-08"],
      "garmin",
    );
  });

  it("lets one stored row absorb only one incoming recording", async () => {
    vi.mocked(storage.workouts.listDeviceRecordingsForDates).mockResolvedValue([storedGarminRow()]);
    const first = stravaRun();
    const second = stravaRun({ id: 9002, start_date: "2026-09-08T11:31:00Z" });

    const result = await dropCrossProviderDuplicates(USER, [first, second], "garmin", describeRun);

    expect(result).toEqual({ kept: [second], duplicates: 1 });
  });

  it("does not query for an empty batch", async () => {
    expect(await dropCrossProviderDuplicates(USER, [], "strava", describeRun)).toEqual({
      kept: [],
      duplicates: 0,
    });
    expect(storage.workouts.listDeviceRecordingsForDates).not.toHaveBeenCalled();
  });
});
