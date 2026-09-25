import { describe, expect, it } from "vitest";

import { implementFor, loadIncrement } from "./exerciseEquipment";

describe("implementFor", () => {
  it("picks the first loaded implement an exercise's equipment table lists", () => {
    expect(implementFor("back_squat")).toBe("barbell");
    // dumbbell precedes kettlebell in the loaded-implement order.
    expect(implementFor("goblet_squat")).toBe("dumbbell");
    expect(implementFor("kettlebell_swings")).toBe("kettlebell");
    expect(implementFor("leg_press")).toBe("machine");
  });

  it("honours the override table ahead of the equipment table", () => {
    expect(implementFor("pull_up")).toBe("bodyweight");
    expect(implementFor("walking_lunges")).toBe("dumbbell");
    expect(implementFor("standing_calf_raise")).toBe("machine");
  });

  it("defaults to barbell for an exercise with no loaded implement, known or not", () => {
    // rowing's only listed equipment ("rower") isn't a loaded implement.
    expect(implementFor("rowing")).toBe("barbell");
    expect(implementFor("not_a_real_exercise")).toBe("barbell");
    expect(implementFor("")).toBe("barbell");
  });
});

describe("loadIncrement", () => {
  it("returns the implement's own step, in the requested unit", () => {
    expect(loadIncrement("back_squat", "kg")).toBe(2.5);
    expect(loadIncrement("back_squat", "lbs")).toBe(5);
    expect(loadIncrement("goblet_squat", "kg")).toBe(2);
    expect(loadIncrement("goblet_squat", "lbs")).toBe(5);
    expect(loadIncrement("kettlebell_swings", "kg")).toBe(4);
    expect(loadIncrement("kettlebell_swings", "lbs")).toBe(5);
    expect(loadIncrement("leg_press", "kg")).toBe(5);
    expect(loadIncrement("leg_press", "lbs")).toBe(10);
  });

  it("falls back to barbell plates for bodyweight work and unknown exercises", () => {
    expect(loadIncrement("pull_up", "kg")).toBe(2.5);
    expect(loadIncrement("pull_up", "lbs")).toBe(5);
    expect(loadIncrement("not_a_real_exercise", "kg")).toBe(2.5);
  });
});
