import type { StravaActivitySummary } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { deviceActivitySetRow, deviceActivitySetRows, exerciseNameForSportType } from "./deviceActivitySets";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";

const KM: { weightUnit: string; distanceUnit: string } = { weightUnit: "kg", distanceUnit: "km" };
const MILES: { weightUnit: string; distanceUnit: string } = { weightUnit: "lbs", distanceUnit: "miles" };

function raw(overrides: Partial<StravaActivitySummary> = {}): StravaActivitySummary {
  return {
    id: 9001,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-09-01T06:30:00Z",
    start_date_local: "2026-09-01T07:30:00Z",
    distance: 10050,
    moving_time: 3133,
    elapsed_time: 3320,
    total_elevation_gain: 84,
    average_speed: 3.208,
    max_speed: 4.6,
    ...overrides,
  };
}

/** A standalone import as the sync writes it: metrics on the row, snapshot attached. */
function importedLog(activity: StravaActivitySummary = raw(), overrides = {}) {
  return makeWorkoutLog({
    id: "log-strava",
    source: "strava",
    stravaActivityId: String(activity.id),
    focus: activity.sport_type,
    duration: Math.round(activity.moving_time / 60),
    distanceMeters: activity.distance,
    deviceActivity: { provider: "strava", raw: activity, filledColumns: [], linkedAt: "2026-09-01T08:00:00Z" },
    ...overrides,
  });
}

describe("exerciseNameForSportType", () => {
  it("maps the sports a recording describes as a set", () => {
    expect(exerciseNameForSportType("Run")).toBe("run");
    expect(exerciseNameForSportType("TrailRun")).toBe("run");
    expect(exerciseNameForSportType("VirtualRun")).toBe("treadmill_run");
    expect(exerciseNameForSportType("GravelRide")).toBe("cycling");
    expect(exerciseNameForSportType("Rowing")).toBe("rowing");
    expect(exerciseNameForSportType("Walk")).toBe("walking");
  });

  it("is case- and whitespace-insensitive, because `type` and `sport_type` disagree on spelling", () => {
    expect(exerciseNameForSportType(" run ")).toBe("run");
    expect(exerciseNameForSportType("RIDE")).toBe("cycling");
  });

  it("refuses the sports whose content the recording does not describe", () => {
    // These are the whole reason the map is an allow-list: a WeightTraining
    // activity says an hour happened and nothing about what was in it, and a
    // guess here would land in the athlete's PR table as fact.
    for (const sport of ["WeightTraining", "Workout", "Crossfit", "Yoga", "Pilates"]) {
      expect(exerciseNameForSportType(sport)).toBeNull();
    }
    expect(exerciseNameForSportType(null)).toBeNull();
    expect(exerciseNameForSportType("")).toBeNull();
  });
});

describe("deviceActivitySetRow", () => {
  it("describes the recording as one distance-and-time set", () => {
    expect(deviceActivitySetRow(importedLog(), KM)).toMatchObject({
      workoutLogId: "log-strava",
      planDayId: null,
      exerciseName: "run",
      category: "running",
      setNumber: 1,
      reps: null,
      weight: null,
      distance: 10050,
      distanceUnit: "m",
      weightUnit: "kg",
    });
  });

  it("takes the clock off the snapshot's seconds, not the row's whole minutes", () => {
    // duration rounds 3133 s to 52 min; reading it back would report a 10.05 km
    // pace of 5:10/km against the 5:12/km the athlete sees on Strava, and would
    // file a "best time" PR that is not the time they ran.
    const row = deviceActivitySetRow(importedLog(), KM);
    expect(row?.time).toBeCloseTo(3133 / 60, 6);
    expect(row?.time).not.toBe(52);
  });

  it("stamps a miles athlete's row in feet, with the value converted", () => {
    const row = deviceActivitySetRow(importedLog(), MILES);
    expect(row?.distanceUnit).toBe("ft");
    expect(row?.weightUnit).toBe("lbs");
    expect(row?.distance).toBe(Math.round(10050 * 3.28084));
  });

  it("falls back to the row's own columns when the log predates the snapshot", () => {
    const row = deviceActivitySetRow(
      makeWorkoutLog({
        id: "legacy",
        source: "strava",
        stravaActivityId: "1",
        focus: "Ride",
        duration: 90,
        distanceMeters: 42000,
        deviceActivity: null,
      }),
      KM,
    );
    expect(row).toMatchObject({ exerciseName: "cycling", category: "conditioning", distance: 42000 });
    expect(row?.time).toBe(90);
  });

  it("writes no set for a sport it cannot describe", () => {
    expect(deviceActivitySetRow(importedLog(raw({ sport_type: "WeightTraining", type: "WeightTraining" })), KM)).toBeNull();
  });

  it("writes no set for a recording with a stopped clock", () => {
    // A zero-minute set would enter the PR table as an unbeatable "best time".
    expect(deviceActivitySetRow(importedLog(raw({ moving_time: 0 })), KM)).toBeNull();
    expect(deviceActivitySetRow(importedLog(raw({ moving_time: -1 })), KM)).toBeNull();
  });

  it("writes no set for a snapshot whose clock is not a number", () => {
    // NaN fails every comparison, so a bare `<= 0` guard would wave it straight
    // into the time column and put NaN in the PR table.
    expect(
      deviceActivitySetRow(importedLog(raw({ moving_time: Number.NaN })), KM),
    ).toBeNull();
  });

  it("keeps a distance-less recording, with no distance rather than a zero", () => {
    const row = deviceActivitySetRow(importedLog(raw({ sport_type: "Elliptical", type: "Elliptical", distance: 0 })), KM);
    expect(row).toMatchObject({ exerciseName: "elliptical", distance: null });
    expect(row?.time).toBeCloseTo(3133 / 60, 6);
  });

  it("carries no reps or weight, so it can never read as a strength set", () => {
    // isStrengthSet (trainingLoadService) keys on reps/weight: a synthesised row
    // that carried either would invent tonnage and move UTSS.
    const row = deviceActivitySetRow(importedLog(), KM);
    expect(row?.reps).toBeNull();
    expect(row?.weight).toBeNull();
  });
});

describe("deviceActivitySetRows", () => {
  it("keeps the describable sports and drops the rest", () => {
    const rows = deviceActivitySetRows(
      [
        importedLog(raw({ id: 1 }), { id: "a" }),
        importedLog(raw({ id: 2, sport_type: "Workout", type: "Workout" }), { id: "b" }),
        importedLog(raw({ id: 3, sport_type: "Swim", type: "Swim" }), { id: "c" }),
      ],
      KM,
    );
    expect(rows.map((r) => [r.workoutLogId, r.exerciseName])).toEqual([
      ["a", "run"],
      ["c", "swimming"],
    ]);
  });
});
