import { describe, expect,it } from "vitest";

import type { StravaActivity } from "./stravaMapper";
import { formatStravaDistance, formatStravaPace,mapStravaActivityToWorkout } from "./stravaMapper";

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

  it("formats pace correctly returning empty string when speed <= 0", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ distance: 5000, average_speed: 0 }),
      "user-1"
    );
    // Since average_speed is 0, Pace should not be in the accessory string.
    expect(result.accessory).not.toMatch(/Pace/);
  });

  it("handles missing average_heartrate but present max_heartrate", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ average_heartrate: undefined, max_heartrate: 178 }),
      "user-1"
    );
    expect(result.notes).not.toMatch(/Avg HR:/);
  });

  it("handles average_heartrate present but max_heartrate absent", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ average_heartrate: 155, max_heartrate: undefined }),
      "user-1"
    );
    expect(result.notes).toMatch(/Avg HR: 155 bpm$/);
  });

  it("handles distance missing/falsy", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ distance: 0 }),
      "user-1"
    );
    expect(result.distanceMeters).toBeNull();
  });


  it("uses sport_type as focus when type is undefined", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ sport_type: "Run", type: undefined }),
      "user-1"
    );
    expect(result.focus).toBe("Run");
  });

  it("uses type as focus when sport_type is undefined", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ sport_type: undefined, type: "Ride" }),
      "user-1"
    );
    expect(result.focus).toBe("Ride");
  });

  it("uses 'Workout' as fallback focus", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ sport_type: undefined, type: undefined }),
      "user-1"
    );
    expect(result.focus).toBe("Workout");
  });

  it("handles null calories and kilojoules", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: undefined, kilojoules: undefined }),
      "user-1"
    );
    expect(result.calories).toBeNull();
  });

  it("handles empty activity name in notes", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ name: "" }),
      "user-1"
    );
    expect(result.notes).toBeNull();
  });

  it("handles missing avgSpeed and maxSpeed", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ average_speed: undefined, max_speed: undefined }),
      "user-1"
    );
    expect(result.avgSpeed).toBeNull();
    expect(result.maxSpeed).toBeNull();
  });

  it("formats duration with hours when moving_time is >= 3600", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ moving_time: 3660 }), // 1h 1m
      "user-1",
    );
    expect(result.mainWorkout).toMatch(/1h 1m/);
  });
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
        max_speed: 5,
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
    expect(result.maxSpeed).toBe(5);
    expect(result.avgCadence).toBe(85);
    expect(result.avgWatts).toBe(200);
    expect(result.sufferScore).toBe(75);
    expect(result.elevationGain).toBe(120);
  });

  it("captures the true start instant from start_date (UTC)", () => {
    const result = mapStravaActivityToWorkout(makeActivity(), "user-1");
    expect(result.startedAt).toEqual(new Date("2026-01-15T08:00:00Z"));
  });

  it("sets startedAt null when start_date is absent", () => {
    const result = mapStravaActivityToWorkout(makeActivity({ start_date: "" }), "user-1");
    expect(result.startedAt).toBeNull();
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

  it("formats pace directly when calling formatStravaPace with speed <= 0", () => {
    // mapStravaActivityToWorkout never calls formatStravaPace when average_speed <= 0
    // (it is guarded by `isDistanceActivity && activity.average_speed > 0`), so the
    // non-positive branch is only reachable by calling formatStravaPace directly.
    expect(formatStravaPace(0, "km")).toBe("");
    expect(formatStravaPace(-5, "miles")).toBe("");
  });

  it("handles calories truthy but falsy after mapping (e.g. 0)", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: 0, kilojoules: 100 }),
      "user-1"
    );
    expect(result.calories).toBeGreaterThan(0);
  });

describe("formatStravaPace", () => {
  it("returns empty string when metersPerSecond <= 0", () => {
    expect(formatStravaPace(0, "km")).toBe("");
    expect(formatStravaPace(-1, "km")).toBe("");
  });
  it("formats pace when > 0", () => {
    expect(formatStravaPace(3.33, "km")).toMatch(/\d+:\d+/);
  });
});

describe("mapStravaActivityToWorkout branch coverage", () => {
  it("handles missing calories but present kilojoules when 0", () => {
    // If calories is falsy, it uses kilojoules. Let's make calories 0.
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: 0, kilojoules: 0 }),
      "user-1"
    );
    expect(result.calories).toBeNull();
  });

  it("handles calories 0 and kilojoules 1", () => {
    // calories: activity.calories || activity.kilojoules ? Math.round((activity.calories || 0) || (activity.kilojoules || 0) * 0.239) : null
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: 0, kilojoules: 1 }),
      "user-1"
    );
    expect(result.calories).toBe(0); // 1 * 0.239 = 0.239 -> round to 0
  });
});

describe("mapStravaActivityToWorkout branch coverage 2", () => {
  it("handles calories 0 and kilojoules undefined", () => {
    // calories: activity.calories || activity.kilojoules ? Math.round((activity.calories || 0) || (activity.kilojoules || 0) * 0.239) : null
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: 0, kilojoules: undefined }),
      "user-1"
    );
    expect(result.calories).toBeNull();
  });
});

describe("mapStravaActivityToWorkout branch coverage 3", () => {
  it("handles calories 1 and kilojoules undefined", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: 1, kilojoules: undefined }),
      "user-1"
    );
    expect(result.calories).toBe(1);
  });
});

describe("mapStravaActivityToWorkout branch coverage 4", () => {
  it("handles calories 0 and kilojoules 0", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: 0, kilojoules: 0 }),
      "user-1"
    );
    expect(result.calories).toBeNull();
  });
  it("handles calories undefined and kilojoules 0", () => {
    const result = mapStravaActivityToWorkout(
      makeActivity({ calories: undefined, kilojoules: 0 }),
      "user-1"
    );
    expect(result.calories).toBeNull();
  });
});
