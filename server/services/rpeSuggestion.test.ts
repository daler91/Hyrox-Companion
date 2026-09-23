import type { StravaActivitySummary } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadSuggestedRpe, suggestRpeFromHeartRate } from "./rpeSuggestion";
import { calculateCardioStressScore } from "./trainingLoad/stressScores";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("../storage", () => ({ storage: { users: { getUser } } }));

// Resting 60, max 190: a 130-beat reserve, so every 13 bpm is a tenth of it.
const ATHLETE = { restingHr: 60, maxHr: 190 };

function recording(sportType: string): StravaActivitySummary {
  return {
    id: 9001,
    name: "Session",
    type: sportType,
    sport_type: sportType,
    start_date: "2026-09-08T11:30:00Z",
    start_date_local: "2026-09-08T06:30:00Z",
    distance: 0,
    moving_time: 3600,
    elapsed_time: 3600,
    total_elevation_gain: 0,
    average_speed: 0,
    max_speed: 0,
  };
}

function importedRun(avgHeartrate: number | null) {
  return makeWorkoutLog({ source: "strava", focus: "Run", avgHeartrate });
}

describe("suggestRpeFromHeartRate", () => {
  it("suggests ten times the heart-rate reserve, rounded", () => {
    // (150 - 60) / 130 = 0.69 of reserve.
    expect(suggestRpeFromHeartRate(importedRun(150), ATHLETE)).toBe(7);
    // (172 - 60) / 130 = 0.86 of reserve.
    expect(suggestRpeFromHeartRate(importedRun(172), ATHLETE)).toBe(9);
  });

  it("stays on the 1-10 scale at both ends", () => {
    expect(suggestRpeFromHeartRate(importedRun(62), ATHLETE)).toBe(1);
    expect(suggestRpeFromHeartRate(importedRun(205), ATHLETE)).toBe(10);
  });

  it("reads against an age-predicted max when none was measured", () => {
    // Tanaka for 40 is 180: (150 - 60) / 120 = 0.75 of reserve.
    expect(suggestRpeFromHeartRate(importedRun(150), { restingHr: 60, age: 40 })).toBe(8);
  });

  it("suggests nothing without a max HR or an age to read the heart rate against", () => {
    // hrReserveRatio withholds rather than assume a 26-year-old's max (audit H3).
    expect(suggestRpeFromHeartRate(importedRun(150), { restingHr: 60 })).toBeNull();
    expect(suggestRpeFromHeartRate(importedRun(150), undefined)).toBeNull();
  });

  it("suggests nothing without heart rate", () => {
    expect(suggestRpeFromHeartRate(importedRun(null), ATHLETE)).toBeNull();
    expect(suggestRpeFromHeartRate(importedRun(0), ATHLETE)).toBeNull();
  });

  it("skips lifting, whose average heart rate under-reads the effort", () => {
    const strava = makeWorkoutLog({ source: "strava", focus: "WeightTraining", avgHeartrate: 131 });
    const garmin = makeWorkoutLog({
      source: "garmin",
      focus: "strength_training",
      avgHeartrate: 131,
    });
    expect(suggestRpeFromHeartRate(strava, ATHLETE)).toBeNull();
    expect(suggestRpeFromHeartRate(garmin, ATHLETE)).toBeNull();
  });

  it("goes by the recording's sport, not the title of the log it was linked to", () => {
    const snapshot = (sport: string) => ({
      provider: "strava" as const,
      raw: recording(sport),
      filledColumns: [],
      linkedAt: "2026-09-08T12:00:00Z",
    });
    const liftingDay = makeWorkoutLog({
      source: "manual",
      focus: "Tempo run",
      avgHeartrate: 150,
      deviceActivity: snapshot("WeightTraining"),
    });
    const runDay = makeWorkoutLog({
      source: "strava",
      focus: "Lower body strength",
      avgHeartrate: 150,
      deviceActivity: snapshot("Run"),
    });
    expect(suggestRpeFromHeartRate(liftingDay, ATHLETE)).toBeNull();
    expect(suggestRpeFromHeartRate(runDay, ATHLETE)).toBe(7);
  });

  it("does not read an athlete-written title as a sport", () => {
    // "WeightTraining" as a manual log's title is just a title.
    const manual = makeWorkoutLog({ source: "manual", focus: "WeightTraining", avgHeartrate: 150 });
    expect(suggestRpeFromHeartRate(manual, ATHLETE)).toBe(7);
  });

  it("is the RPE the cardio load model scores the same as the heart rate", () => {
    // Pinned at whole tenths of the reserve, where rounding cannot blur it. If
    // either cardio curve is retuned, the suggestion stops describing the
    // load the session was given, and this fails.
    for (const tenths of [3, 5, 7, 9]) {
      const avgHeartrate = ATHLETE.restingHr + tenths * 13;
      const log = makeWorkoutLog({ source: "strava", focus: "Run", duration: 60, avgHeartrate });
      const suggested = suggestRpeFromHeartRate(log, ATHLETE);
      expect(suggested, `HR ${avgHeartrate}`).toBe(tenths);

      const byHeartRate = calculateCardioStressScore(log, [], undefined, ATHLETE);
      const byRpe = calculateCardioStressScore(
        { ...log, avgHeartrate: null, rpe: suggested },
        [],
        undefined,
        ATHLETE,
      );
      expect(byRpe, `HR ${avgHeartrate}`).toBe(byHeartRate);
    }
  });
});

describe("loadSuggestedRpe", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("reads the athlete's heart-rate profile for a log that can get a suggestion", async () => {
    getUser.mockResolvedValue({ restingHr: 60, maxHr: 190, age: 35 });

    await expect(loadSuggestedRpe(importedRun(150), "user-1")).resolves.toBe(7);
    expect(getUser).toHaveBeenCalledWith("user-1");
  });

  it("skips the profile read when there is nothing to suggest from", async () => {
    await expect(loadSuggestedRpe(importedRun(null), "user-1")).resolves.toBeNull();
    const lifting = makeWorkoutLog({
      source: "strava",
      focus: "WeightTraining",
      avgHeartrate: 120,
    });
    await expect(loadSuggestedRpe(lifting, "user-1")).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("suggests nothing for an athlete with no profile row", async () => {
    getUser.mockResolvedValue(undefined);
    await expect(loadSuggestedRpe(importedRun(150), "user-1")).resolves.toBeNull();
  });
});
