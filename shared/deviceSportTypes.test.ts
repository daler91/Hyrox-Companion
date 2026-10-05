import { describe, expect, it } from "vitest";

import {
  cadenceUnitFor,
  countsAsTraining,
  heartRateReflectsEffort,
  isIndoorRunSportType,
  isRunSportType,
} from "./deviceSportTypes";

describe("countsAsTraining", () => {
  it("excludes the sports that arrive without being training", () => {
    expect(countsAsTraining("Walk")).toBe(false);
    expect(countsAsTraining("EBikeRide")).toBe(false);
    expect(countsAsTraining("Yoga")).toBe(false);
    expect(countsAsTraining("Golf")).toBe(false);
  });

  it("excludes every e-bike sport from both providers", () => {
    // C46 (CODEBASE_ANALYSIS_2026-10-03): Strava's e-MTB counted while its road
    // e-bike and Garmin's e-MTB did not.
    for (const sport of ["EBikeRide", "EMountainBikeRide", "e_bike_fitness", "e_bike_mountain"]) {
      expect(countsAsTraining(sport), sport).toBe(false);
    }
    // The non-assisted rides still count.
    expect(countsAsTraining("MountainBikeRide")).toBe(true);
    expect(countsAsTraining("mountain_biking")).toBe(true);
  });

  it("keeps the sports that are", () => {
    for (const sport of [
      "Run",
      "TrailRun",
      "VirtualRun",
      "Ride",
      "GravelRide",
      "Rowing",
      "Swim",
      "WeightTraining",
      "Workout",
      "Crossfit",
      "HighIntensityIntervalTraining",
      "Elliptical",
      "StairStepper",
    ]) {
      expect(countsAsTraining(sport), sport).toBe(true);
    }
  });

  it("counts hiking — three hours uphill is training", () => {
    // Called out because it is the arguable one: an athlete who hikes as
    // training should not have to re-tag every session.
    expect(countsAsTraining("Hike")).toBe(true);
    expect(countsAsTraining("hiking")).toBe(true);
  });

  it("reads both providers' spellings of the same sport", () => {
    // Strava sends PascalCase sport_type, Garmin snake_case typeKey.
    expect(countsAsTraining("walking")).toBe(false);
    expect(countsAsTraining("e_bike_fitness")).toBe(false);
    expect(countsAsTraining(" WALK ")).toBe(false);
    expect(countsAsTraining("E-Bike Ride")).toBe(false);
  });

  it("counts anything it does not recognise", () => {
    // The deny-list is deliberate: a sport type we have never seen should show
    // up in the athlete's training, not vanish from it.
    expect(countsAsTraining("Kitesurf")).toBe(true);
    expect(countsAsTraining("SomeNewStravaSport")).toBe(true);
  });

  it("counts a missing sport, rather than guessing it away", () => {
    expect(countsAsTraining(null)).toBe(true);
    expect(countsAsTraining(undefined)).toBe(true);
    expect(countsAsTraining("")).toBe(true);
  });
});

describe("heartRateReflectsEffort", () => {
  it("rules out lifting in both providers' spellings", () => {
    // A heavy session's average heart rate reads like a walk.
    expect(heartRateReflectsEffort("WeightTraining")).toBe(false);
    expect(heartRateReflectsEffort("strength_training")).toBe(false);
  });

  it("rules out the mind-body sports", () => {
    expect(heartRateReflectsEffort("Yoga")).toBe(false);
    expect(heartRateReflectsEffort("pilates")).toBe(false);
  });

  it("keeps the sports whose effort shows in the heart rate", () => {
    for (const sport of ["Run", "Ride", "Rowing", "Swim", "Workout", "Crossfit", "indoor_cardio"]) {
      expect(heartRateReflectsEffort(sport), sport).toBe(true);
    }
  });

  it("keeps an unknown or missing sport, whose suggestion the athlete still confirms", () => {
    expect(heartRateReflectsEffort("SomeNewStravaSport")).toBe(true);
    expect(heartRateReflectsEffort(null)).toBe(true);
    expect(heartRateReflectsEffort("")).toBe(true);
  });
});

describe("isRunSportType", () => {
  it("recognises runs in both providers' spellings", () => {
    for (const sport of ["Run", "TrailRun", "VirtualRun", "running", "trail_running", "treadmill_running"]) {
      expect(isRunSportType(sport), sport).toBe(true);
    }
  });

  it("refuses everything else, including an unknown or missing sport", () => {
    for (const sport of ["Ride", "Walk", "Rowing", "Workout", "WeightTraining", "SomeNewSport", "", null]) {
      expect(isRunSportType(sport), String(sport)).toBe(false);
    }
  });
});

describe("isIndoorRunSportType", () => {
  it("flags treadmill and virtual runs, whose pace is not GPS", () => {
    expect(isIndoorRunSportType("VirtualRun")).toBe(true);
    expect(isIndoorRunSportType("treadmill_running")).toBe(true);
    expect(isIndoorRunSportType("Run")).toBe(false);
    expect(isIndoorRunSportType(undefined)).toBe(false);
  });
});

describe("cadenceUnitFor", () => {
  it("reads a ride's cadence as pedal rpm, in both providers' spellings", () => {
    for (const sport of ["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "cycling", "indoor_cycling", "road_biking"]) {
      expect(cadenceUnitFor(sport), sport).toBe("rpm");
    }
  });

  it("reads every other sport, and an unknown one, as steps per minute", () => {
    for (const sport of ["Run", "TrailRun", "running", "Rowing", "Walk", "Workout"]) {
      expect(cadenceUnitFor(sport), sport).toBe("spm");
    }
    expect(cadenceUnitFor(null)).toBe("spm");
    expect(cadenceUnitFor(undefined)).toBe("spm");
    expect(cadenceUnitFor("")).toBe("spm");
  });
});
