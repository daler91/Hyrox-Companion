import { describe, expect,it } from "vitest";

import type { GarminActivity } from "./garminMapper";
import { mapGarminActivityToWorkout } from "./garminMapper";

function makeActivity(overrides: Partial<GarminActivity> = {}): GarminActivity {
  return {
    activityId: 9876543210,
    activityName: "Morning Run",
    startTimeLocal: "2026-01-15 08:00:00",
    startTimeGMT: "2026-01-15T06:00:00.0",
    activityType: { typeKey: "running" },
    distance: 5000,
    duration: 1600,
    movingDuration: 1500,
    elevationGain: 50,
    averageSpeed: 3.33,
    maxSpeed: 4.5,
    averageHR: 150,
    maxHR: 175,
    calories: 400,
    averageRunningCadenceInStepsPerMinute: 170,
    ...overrides,
  };
}

describe("mapGarminActivityToWorkout", () => {
  it("maps a basic distance activity", () => {
    const result = mapGarminActivityToWorkout(makeActivity(), "user-1");
    expect(result.userId).toBe("user-1");
    expect(result.date).toBe("2026-01-15");
    expect(result.focus).toBe("running");
    expect(result.source).toBe("garmin");
    expect(result.garminActivityId).toBe("9876543210");
    // movingDuration 1500s -> 25 minutes
    expect(result.duration).toBe(25);
    expect(result.distanceMeters).toBe(5000);
    expect(result.mainWorkout).toMatch(/km/);
  });

  it("falls back to duration when movingDuration is missing", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ movingDuration: undefined, duration: 600 }),
      "user-1",
    );
    expect(result.duration).toBe(10);
  });

  it("uses session-style format for non-distance activities", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({
        distance: 0,
        activityType: { typeKey: "strength_training" },
      }),
      "user-1",
    );
    expect(result.mainWorkout).toMatch(/session/);
    expect(result.focus).toBe("strength_training");
    expect(result.distanceMeters).toBeNull();
  });

  it("includes elevation in accessory when > 0", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ elevationGain: 100 }),
      "user-1",
    );
    expect(result.accessory).toMatch(/Elevation/);
  });

  it("includes pace in accessory for distance activities", () => {
    const result = mapGarminActivityToWorkout(makeActivity(), "user-1");
    expect(result.accessory).toMatch(/Pace/);
  });

  it("returns null accessory when no extras present", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ distance: 10, elevationGain: 0 }),
      "user-1",
    );
    expect(result.accessory).toBeNull();
  });

  it("includes heart rate in notes when present", () => {
    const result = mapGarminActivityToWorkout(makeActivity(), "user-1");
    expect(result.notes).toMatch(/Avg HR: 150 bpm/);
    expect(result.notes).toMatch(/max 175/);
  });

  it("includes activity name in notes", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ activityName: "Evening Jog" }),
      "user-1",
    );
    expect(result.notes).toMatch(/Evening Jog/);
  });

  it("formats distance in miles when requested", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ distance: 1609 }),
      "user-1",
      "miles",
    );
    expect(result.mainWorkout).toMatch(/mi/);
  });

  it("sets planDayId to null", () => {
    const result = mapGarminActivityToWorkout(makeActivity(), "user-1");
    expect(result.planDayId).toBeNull();
  });

  it("sets sufferScore to null (Garmin has no equivalent)", () => {
    const result = mapGarminActivityToWorkout(makeActivity(), "user-1");
    expect(result.sufferScore).toBeNull();
  });

  it("treats activity at 101m as distance-based", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ distance: 101 }),
      "user-1",
    );
    expect(result.mainWorkout).toMatch(/km|mi/);
  });

  it("treats activity at exactly 100m as non-distance-based", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ distance: 100 }),
      "user-1",
    );
    expect(result.mainWorkout).toMatch(/session/);
  });

  it("maps numeric fields correctly", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({
        averageHR: 160,
        maxHR: 180,
        averageSpeed: 3.5,
        maxSpeed: 5,
        averageRunningCadenceInStepsPerMinute: 165,
        avgPower: 220,
        elevationGain: 120,
        calories: 450,
      }),
      "user-1",
    );
    expect(result.avgHeartrate).toBe(160);
    expect(result.maxHeartrate).toBe(180);
    expect(result.avgSpeed).toBe(3.5);
    expect(result.maxSpeed).toBe(5);
    expect(result.avgCadence).toBe(165);
    expect(result.avgWatts).toBe(220);
    expect(result.elevationGain).toBe(120);
    expect(result.calories).toBe(450);
  });

  it("handles missing avgPower gracefully", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ avgPower: null }),
      "user-1",
    );
    expect(result.avgWatts).toBeNull();
  });

  it("falls back to 'Workout' when typeKey missing", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ activityType: undefined }),
      "user-1",
    );
    expect(result.focus).toBe("Workout");
  });

  it("parses ISO-8601 startTimeLocal with T separator", () => {
    const result = mapGarminActivityToWorkout(
      makeActivity({ startTimeLocal: "2026-03-22T07:30:00" }),
      "user-1",
    );
    expect(result.date).toBe("2026-03-22");
  });

  it("uses garmin source string and unique id field", () => {
    const result = mapGarminActivityToWorkout(makeActivity(), "user-1");
    expect(result.source).toBe("garmin");
    expect(result.garminActivityId).toBe("9876543210");
    // Should NOT shadow the Strava field
    expect(result).not.toHaveProperty("stravaActivityId");
  });
});
