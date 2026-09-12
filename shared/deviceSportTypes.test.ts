import { describe, expect, it } from "vitest";

import { countsAsTraining } from "./deviceSportTypes";

describe("countsAsTraining", () => {
  it("excludes the sports that arrive without being training", () => {
    expect(countsAsTraining("Walk")).toBe(false);
    expect(countsAsTraining("EBikeRide")).toBe(false);
    expect(countsAsTraining("Yoga")).toBe(false);
    expect(countsAsTraining("Golf")).toBe(false);
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
