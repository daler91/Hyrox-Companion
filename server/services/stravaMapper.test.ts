import { describe, it, expect } from "vitest";
import { mapStravaActivityToWorkout, formatStravaDistance } from "./stravaMapper";
import type { StravaActivity } from "./stravaMapper";

function makeActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 12345,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-01-15T08:00:00Z",
    start_date_local: "2026-01-15T10:00:00+02:00",
    distance: 5000,
    moving_time: 1500,
    elapsed_time: 1600,
    total_elevation_gain: 50,
    average_speed: 3.33,
    max_speed: 4.5,
    ...overrides,
  };
}

describe("mapStravaActivityToWorkout", () => {
  it("maps basic distance activity correctly", () => {
    const result = mapStravaActivityToWorkout(makeActivity(), "user-1");
    expect(result.userId).toBe("user-1");
    expect(result.date).toBe("2026-01-15");
    expect(result.focus).toBe("Run");
    expect(result.source).toBe("strava");
    expect(result.stravaActivityId).toBe("12345");
    expect(result.duration).toBe(25);
    expect(result.distanceMeters).toBe(5000);
    expect(result.mainWorkout).toMatch(/km/);
  });

  it("uses duration-based format for non-distance activities", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ distance: 50, sport_type: "Yoga" }),
      "user-1",
    );
    expect(result.mainWorkout).toMatch(/session/);
    expect(result.focus).toBe("Yoga");
  });

  it("includes elevation in accessory when > 0", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ total_elevation_gain: 100 }),
      "user-1",
    );
    expect(result.accessory).toMatch(/Elevation/);
  });

  it("includes pace in accessory for distance activities", () => {
    const result = mapStravaActivityToWorkout(makeActivity(), "user-1");
    expect(result.accessory).toMatch(/Pace/);
  });

  it("excludes pace for non-distance activities", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ distance: 10, total_elevation_gain: 0 }),
      "user-1",
    );
    expect(result.accessory).toBeNull();
  });

  it("includes heart rate in notes when present", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ average_heartrate: 155, max_heartrate: 178 }),
      "user-1",
    );
    expect(result.notes).toMatch(/Avg HR: 155 bpm/);
    expect(result.notes).toMatch(/max 178/);
  });

  it("includes activity name in notes", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ name: "Evening Jog" }),
      "user-1",
    );
    expect(result.notes).toMatch(/Evening Jog/);
  });

  it("formats distance in miles when requested", () => {
    const result = mapStravaActivityToWorkout(makeActivity({ distance: 1609 }), "user-1", "miles");
    expect(result.mainWorkout).toMatch(/mi/);
  });

  it("sets planDayId to null", () => {
    const result = mapStravaActivityToWorkout(makeActivity(), "user-1");
    expect(result.planDayId).toBeNull();
  });

  it("handles calories from kilojoules", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ kilojoules: 500, calories: undefined }),
      "user-1",
    );
    expect(result.calories).toBeGreaterThan(0);
  });

  it("treats activity at 101m as distance-based", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ distance: 101 }),
      "user-1",
    );
    expect(result.mainWorkout).toMatch(/km|mi/);
  });

  it("treats activity at exactly 100m as non-distance-based", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ distance: 100 }),
      "user-1",
    );
    expect(result.mainWorkout).toMatch(/session/);
  });

  it("maps numeric fields correctly", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({
        average_heartrate: 150,
        max_heartrate: 175,
        average_speed: 3.5,
        max_speed: 5.0,
        average_cadence: 85,
        average_watts: 200,
        suffer_score: 75,
        total_elevation_gain: 120,
      }),
      "user-1",
    );
    expect(result.avgHeartrate).toBe(150);
    expect(result.maxHeartrate).toBe(175);
    expect(result.avgSpeed).toBe(3.5);
    expect(result.maxSpeed).toBe(5.0);
    expect(result.avgCadence).toBe(85);
    expect(result.avgWatts).toBe(200);
    expect(result.sufferScore).toBe(75);
    expect(result.elevationGain).toBe(120);
  });
});

describe("formatStravaDistance", () => {
  it("formats positive distances correctly in km", () => {
    expect(formatStravaDistance(1000, "km")).toBe("1 km");
    expect(formatStravaDistance(1500, "km")).toBe("1.5 km");
    expect(formatStravaDistance(5432, "km")).toBe("5.43 km");
  });

  it("formats positive distances correctly in miles", () => {
    // 1609.34 meters is ~1.00 miles
    expect(formatStravaDistance(1609.344, "miles")).toBe("1 mi");
    expect(formatStravaDistance(5000, "miles")).toBe("3.11 mi"); // 5km is ~3.11 miles
  });

  it("handles 0 meters correctly", () => {
    expect(formatStravaDistance(0, "km")).toBe("0 km");
    expect(formatStravaDistance(0, "miles")).toBe("0 mi");
  });

  it("handles negative distances correctly", () => {
    expect(formatStravaDistance(-1000, "km")).toBe("-1 km");
    expect(formatStravaDistance(-1609.344, "miles")).toBe("-1 mi");
  });
});
