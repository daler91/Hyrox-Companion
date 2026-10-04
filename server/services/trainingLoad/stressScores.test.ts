import type { StravaActivitySummary, WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { calculateTrainingLoad } from "../trainingLoadService";
import { makeWorkoutLog } from "../trainingLoadService.testHelpers";
import { calculateCardioStressScore } from "./stressScores";

/**
 * C12 (CODEBASE_ANALYSIS_2026-10-03): the cardio intensity factor took average
 * heart rate whenever there was one, with no sport filter, so a set-less
 * lifting import was scored as the walk its average heart rate resembles even
 * when the athlete had rated it. `heartRateReflectsEffort` already decides this
 * for bodySystemLoad and the RPE suggestion; the UTSS path now follows it too.
 */

// Resting 60, max 190: HR 105 is 35% of the reserve, an easy-walk reading.
const ATHLETE = { restingHr: 60, maxHr: 190 };

/** 60 min at RPE 8 on the RPE branch: 60 x (0.6 + 0.8² x 2). */
const RATED_HOUR_AT_RPE_8 = 112.8;

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

function liftingHour(overrides: Partial<WorkoutLog>): WorkoutLog {
  return makeWorkoutLog({
    duration: 60,
    avgHeartrate: 105,
    rpe: 8,
    mainWorkout: "Weight Training",
    ...overrides,
  });
}

describe("calculateCardioStressScore — heart rate only where it reflects effort (C12)", () => {
  it("scores a rated lifting import from the athlete's RPE, not its average HR", () => {
    const strava = liftingHour({ source: "strava", focus: "WeightTraining" });
    const garmin = liftingHour({ source: "garmin", focus: "strength_training" });
    expect(calculateCardioStressScore(strava, [], undefined, ATHLETE)).toBe(RATED_HOUR_AT_RPE_8);
    expect(calculateCardioStressScore(garmin, [], undefined, ATHLETE)).toBe(RATED_HOUR_AT_RPE_8);
  });

  it("goes by the linked recording's sport, not the log's title", () => {
    const linked = liftingHour({
      source: "manual",
      focus: "Lower body strength",
      deviceActivity: {
        provider: "strava",
        raw: recording("WeightTraining"),
        filledColumns: [],
        linkedAt: "2026-09-08T12:00:00Z",
      },
    });
    expect(calculateCardioStressScore(linked, [], undefined, ATHLETE)).toBe(RATED_HOUR_AT_RPE_8);
  });

  it("does not fall back to the heart rate for an unrated lifting import", () => {
    // 35% of reserve would score 50.4. Unrated, it takes the keyword default
    // (1.1) the RPE-less path gives any session it cannot read.
    const unrated = liftingHour({ source: "strava", focus: "WeightTraining", rpe: null });
    expect(calculateCardioStressScore(unrated, [], undefined, ATHLETE)).toBe(66);
  });

  it("still prefers heart rate over RPE for a run", () => {
    const run = liftingHour({ source: "strava", focus: "Run", mainWorkout: "Run" });
    // 35% of reserve: 60 x (0.6 + 0.346² x 2) = 50.4, not the RPE-8 score.
    expect(calculateCardioStressScore(run, [], undefined, ATHLETE)).toBe(50.4);
  });

  it("carries the rated load into the day's UTSS", () => {
    const currentDate = "2026-05-22";
    const log = liftingHour({
      id: "lift",
      date: currentDate,
      source: "strava",
      focus: "WeightTraining",
    });
    const { dailyLoads } = calculateTrainingLoad([log], [], [], { currentDate, athlete: ATHLETE });
    expect(dailyLoads.find((d) => d.date === currentDate)?.utss).toBe(RATED_HOUR_AT_RPE_8);
  });
});
