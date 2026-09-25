import { BODY_SYSTEMS } from "@shared/bodySystemLoad";
import { EXERCISE_DEFINITIONS, exerciseNames } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  bodySystemProfileForSet,
  catalogueBodySystemProfile,
  inferExerciseFromTitle,
} from "./bodySystemProfiles";

const CATEGORY_BY_NAME = new Map(
  Object.entries(EXERCISE_DEFINITIONS).map(([name, definition]) => [name, definition.category]),
);

function catalogueNamesIn(category: string) {
  return exerciseNames.filter((name) => CATEGORY_BY_NAME.get(name) === category);
}

describe("catalogueBodySystemProfile", () => {
  it("gives every catalogue exercise a share between 0 and 1 for every system", () => {
    for (const name of exerciseNames) {
      const profile = catalogueBodySystemProfile(name);
      expect(new Set(Object.keys(profile)), name).toEqual(new Set(BODY_SYSTEMS));
      for (const [system, share] of Object.entries(profile)) {
        expect(share, `${name}.${system}`).toBeGreaterThanOrEqual(0);
        expect(share, `${name}.${system}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("makes every run full aerobic and foot-strike work with no pulling", () => {
    const runs = catalogueNamesIn("running");
    expect(runs.length).toBeGreaterThan(5);
    for (const name of runs) {
      const profile = catalogueBodySystemProfile(name);
      expect(profile.aerobic, name).toBe(1);
      expect(profile.running_impact, name).toBeGreaterThanOrEqual(0.85);
      expect(profile.leg_muscle, name).toBeGreaterThan(0);
      expect(profile.upper_pull, name).toBe(0);
    }
  });

  it("never gives a lift running impact", () => {
    const lifts = catalogueNamesIn("strength");
    for (const name of lifts) {
      expect(catalogueBodySystemProfile(name).running_impact, name).toBe(0);
    }
  });

  it("puts squats and hinges on the legs and rows and pull-ups on the pull", () => {
    for (const name of ["back_squat", "deadlift", "bulgarian_split_squat", "leg_press"] as const) {
      expect(catalogueBodySystemProfile(name).leg_muscle, name).toBe(1);
    }
    for (const name of ["pull_up", "bent_over_row", "lat_pulldown", "seated_cable_row"] as const) {
      const profile = catalogueBodySystemProfile(name);
      expect(profile.upper_pull, name).toBe(1);
      expect(profile.leg_muscle, name).toBe(0);
    }
  });

  it("leaves pressing off both the legs and the pull", () => {
    expect(catalogueBodySystemProfile("bench_press")).toEqual({
      aerobic: 0.15,
      running_impact: 0,
      leg_muscle: 0,
      upper_pull: 0,
    });
  });

  it("counts isolated pulling muscles at a reduced share", () => {
    // Biceps only, no pulling pattern: 0.6 of a row.
    expect(catalogueBodySystemProfile("barbell_curl").upper_pull).toBeCloseTo(0.6);
    // A deadlift's grip and lats: half its muscles are pulling muscles.
    expect(catalogueBodySystemProfile("deadlift").upper_pull).toBeCloseTo(0.3);
  });

  it("separates the ergs by what they actually load", () => {
    const skierg = catalogueBodySystemProfile("skierg");
    const rower = catalogueBodySystemProfile("rowing");
    const bike = catalogueBodySystemProfile("cycling");
    for (const profile of [skierg, rower, bike]) expect(profile.running_impact).toBe(0);
    expect(skierg.upper_pull).toBeGreaterThan(rower.upper_pull);
    expect(rower.leg_muscle).toBeGreaterThan(skierg.leg_muscle);
    expect(bike.upper_pull).toBe(0);
  });

  it("loads the HYROX sleds where they are felt", () => {
    expect(catalogueBodySystemProfile("sled_push").leg_muscle).toBe(1);
    expect(catalogueBodySystemProfile("sled_push").upper_pull).toBe(0);
    expect(catalogueBodySystemProfile("sled_pull").upper_pull).toBe(1);
  });
});

describe("bodySystemProfileForSet", () => {
  it("resolves a custom set through its label", () => {
    expect(
      bodySystemProfileForSet({
        exerciseName: "custom",
        customLabel: "Pullups",
        category: "strength",
      }),
    ).toEqual(catalogueBodySystemProfile("pull_up"));
  });

  it("attributes only the category's aerobic share to an unknown custom exercise", () => {
    expect(
      bodySystemProfileForSet({
        exerciseName: "custom",
        customLabel: "Zottman curl",
        category: "strength",
      }),
    ).toEqual({ aerobic: 0.15, running_impact: 0, leg_muscle: 0, upper_pull: 0 });
  });

  it("returns null when neither the name, the label nor the category is known", () => {
    expect(
      bodySystemProfileForSet({
        exerciseName: "custom",
        customLabel: "Mystery",
        category: "other",
      }),
    ).toBeNull();
  });
});

describe("inferExerciseFromTitle", () => {
  it.each([
    ["Easy run", "", "easy_run"],
    ["Morning Run", "", "run"],
    ["TrailRun", "", "run"],
    ["VirtualRide", "", "cycling"],
    ["lap_swimming", "", "swimming"],
    ["StairStepper", "", "stair_climber"],
    ["SkiErg 5x500", "", "skierg"],
    ["Ski Erg intervals", "", "ski_erg_intervals"],
    ["Recovery", "30 min walk with the dog", "walking"],
  ])("reads %j / %j as %s", (focus, mainWorkout, expected) => {
    expect(inferExerciseFromTitle({ focus, mainWorkout })).toBe(expected);
  });

  it.each([
    ["WeightTraining", ""],
    ["Hyrox class", ""],
    ["Brunch with friends", ""],
    ["Crow pose yoga", ""],
  ])("attributes nothing to %j", (focus, mainWorkout) => {
    expect(inferExerciseFromTitle({ focus, mainWorkout })).toBeNull();
  });
});
