import { type HealthConnectSessionInput,healthConnectSessionSchema } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  healthConnectLocalDate,
  healthConnectRecordingMeasurements,
  mapHealthConnectSessionToWorkout,
} from "./healthConnectMapper";

function session(overrides: Partial<HealthConnectSessionInput> = {}): HealthConnectSessionInput {
  return {
    id: "hc-1",
    startTime: "2026-11-08T07:02:00Z",
    endTime: "2026-11-08T07:47:00Z",
    sportType: "Run",
    distanceMeters: 8100,
    ...overrides,
  };
}

describe("healthConnectLocalDate", () => {
  it("uses the session's own offset, so a late-evening run stays on its day", () => {
    const late = session({ startTime: "2026-11-08T23:30:00Z", endTime: "2026-11-09T00:10:00Z" });
    expect(healthConnectLocalDate({ ...late, zoneOffsetMinutes: -300 }, "UTC")).toBe("2026-11-08");
    expect(healthConnectLocalDate({ ...late, zoneOffsetMinutes: 60 }, "UTC")).toBe("2026-11-09");
  });

  it("falls back to the athlete's time zone without one", () => {
    const late = session({ startTime: "2026-11-09T02:00:00Z", endTime: "2026-11-09T02:40:00Z" });
    expect(healthConnectLocalDate(late, "America/New_York")).toBe("2026-11-08");
    expect(healthConnectLocalDate(late, "Not/AZone")).toBe("2026-11-09");
  });
});

describe("mapHealthConnectSessionToWorkout", () => {
  it("maps a run as a standalone Health Connect import", () => {
    const row = mapHealthConnectSessionToWorkout(
      session({ title: "Morning run", avgHeartRate: 151, maxHeartRate: 172, activeCalories: 610.4, zoneOffsetMinutes: 60 }),
      "user-1",
      { distanceUnit: "km" },
    );
    expect(row).toMatchObject({
      userId: "user-1",
      date: "2026-11-08",
      startedAt: new Date("2026-11-08T07:02:00Z"),
      focus: "Run",
      duration: 45,
      source: "health_connect",
      healthConnectId: "hc-1",
      countsAsTraining: true,
      calories: 610,
      distanceMeters: 8100,
      avgHeartrate: 151,
      maxHeartrate: 172,
      notes: "Morning run | Avg HR: 151 bpm (max 172)",
      planDayId: null,
      rpe: null,
    });
    expect(row.mainWorkout).toMatch(/^8\.1\d? km, /);
    expect(row.accessory).toMatch(/^Pace: /);
    expect(row.avgSpeed).toBeCloseTo(3, 5);
  });

  it("describes a session without distance by its length", () => {
    const row = mapHealthConnectSessionToWorkout(session({ sportType: "WeightTraining", distanceMeters: undefined }), "user-1");
    expect(row.mainWorkout).toMatch(/ session$/);
    expect(row.accessory).toBeNull();
    expect(row.avgSpeed).toBeNull();
  });

  it("gives its synthesised set the session's span", () => {
    expect(healthConnectRecordingMeasurements(session())).toEqual({ sportType: "Run", movingSeconds: 45 * 60, distanceMeters: 8100 });
  });
});

describe("healthConnectSessionSchema", () => {
  it("accepts a session and refuses one that ends before it starts or runs past a day", () => {
    expect(healthConnectSessionSchema.safeParse(session()).success).toBe(true);
    expect(healthConnectSessionSchema.safeParse(session({ endTime: "2026-11-08T07:00:00Z" })).success).toBe(false);
    expect(healthConnectSessionSchema.safeParse(session({ endTime: "2026-11-09T07:03:00Z" })).success).toBe(false);
  });
});
