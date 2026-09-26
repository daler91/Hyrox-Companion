import { describe, expect, it } from "vitest";

import { buildStationPhasePlan } from "./stations";

function dose(plan: ReturnType<typeof buildStationPhasePlan>, station: string) {
  return plan.doses.find((entry) => entry.station === station);
}

describe("buildStationPhasePlan", () => {
  it("loads the early phase heavier than race weight, on real sled plates", () => {
    const plan = buildStationPhasePlan("early", { division: "open", gender: "male", unit: "kg" });
    // 152 kg x 1.2 = 182.4 → 180 kg.
    expect(dose(plan, "sled_push")).toMatchObject({ sets: 5, distanceMeters: 12.5, load: 180 });
    expect(dose(plan, "wall_balls")).toMatchObject({ reps: 15, load: 6 });
  });

  it("reaches full race distance at exactly the rulebook load in the peak", () => {
    const plan = buildStationPhasePlan("peak", { division: "open", gender: "female", unit: "kg" });
    // Race load is rehearsed as raced: 102 kg, not the nearest 5 kg plate.
    expect(dose(plan, "sled_push")).toMatchObject({ distanceMeters: 50, load: 102 });
    expect(dose(plan, "farmers_carry")).toMatchObject({ distanceMeters: 200, load: 16 });
  });

  it("converts to pounds: race load exactly, heavier doses on pound plates", () => {
    const build = buildStationPhasePlan("build", {
      division: "pro",
      gender: "female",
      unit: "lbs",
    });
    // 152 kg = 335.1 lb.
    expect(dose(build, "sled_push")?.load).toBe(335);
    const early = buildStationPhasePlan("early", {
      division: "pro",
      gender: "female",
      unit: "lbs",
    });
    // 152 kg x 1.2 = 402 lb → 400 lb on 10 lb steps.
    expect(dose(early, "sled_push")?.load).toBe(400);
  });

  it("leaves loads as a fraction of race weight when the category is unknown", () => {
    const plan = buildStationPhasePlan("build", { division: "open", gender: null, unit: "kg" });
    expect(dose(plan, "sled_push")).toMatchObject({ loadFraction: 1 });
    expect(dose(plan, "sled_push")).not.toHaveProperty("load");
  });

  it("drops stations the athlete can't train and never loads the ergs", () => {
    const plan = buildStationPhasePlan("build", {
      division: "open",
      gender: "male",
      unit: "kg",
      excluded: new Set(["sled_push", "sled_pull"]),
    });
    expect(plan.doses.map((entry) => entry.station)).not.toContain("sled_push");
    expect(dose(plan, "skierg")).not.toHaveProperty("load");
    expect(plan.intent).toMatch(/race load/);
  });
});
