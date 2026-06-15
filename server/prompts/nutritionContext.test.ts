import { describe, expect, it } from "vitest";

import type { NutritionCoachContext, TrainingContext } from "../gemini/types";
import { buildNutritionSection } from "./nutritionContext";

function ctx(nutrition?: NutritionCoachContext): TrainingContext {
  return { nutrition } as TrainingContext;
}

const FULL: NutritionCoachContext = {
  windowDays: 14,
  loggedDaysCount: 9,
  avgCalories: 2450,
  avgProteinG: 165,
  avgCarbG: 280,
  avgFatG: 80,
  target: { calories: 2600, proteinG: 180, carbG: 300, fatG: 75 },
  highLoadDays: [
    { date: "2026-06-05", utss: 92, calories: 2200, proteinG: 140 },
    { date: "2026-06-02", utss: 78, calories: 2600, proteinG: 175 },
  ],
  lowMicros: ["Iron 32%", "Vitamin D 18%"],
};

const NEXT_SESSION: NonNullable<NutritionCoachContext["nextSessionFuelling"]> = {
  date: "2026-06-10",
  focus: "Strength",
  durationMin: 60,
  rpe: 7,
  estimated: true,
  preCarbG: 35,
  postCarbG: 50,
  postProteinG: 25,
};

describe("buildNutritionSection", () => {
  it("returns an empty string when no nutrition context is present", () => {
    expect(buildNutritionSection(ctx())).toBe("");
  });

  it("renders averages, target, high-load days and low micros", () => {
    const out = buildNutritionSection(ctx(FULL));
    expect(out).toContain("Fuelling and Recovery (last 14 days, 9 days logged):");
    expect(out).toContain("Avg on logged days: 2450 kcal, 165g protein, 280g carbs, 80g fat.");
    expect(out).toContain("Daily target: 2600 kcal, 180g protein, 300g carbs, 75g fat.");
    expect(out).toContain("2026-06-05 (UTSS 92: 2200 kcal, 140g protein)");
    expect(out).toContain("Iron 32%, Vitamin D 18%");
  });

  it("never emits an ampersand (repo formatting rule)", () => {
    expect(buildNutritionSection(ctx(FULL))).not.toContain("&");
  });

  it("handles no logs / no target / no micros gracefully", () => {
    const out = buildNutritionSection(
      ctx({
        windowDays: 14,
        loggedDaysCount: 0,
        avgCalories: 0,
        avgProteinG: 0,
        avgCarbG: 0,
        avgFatG: 0,
        highLoadDays: [],
        lowMicros: [],
      }),
    );
    expect(out).toContain("0 days logged");
    expect(out).toContain("No food logged in this window yet.");
    expect(out).not.toContain("Daily target");
    expect(out).not.toContain("Highest training-load");
    expect(out).not.toContain("Micronutrients low");
  });

  it("uses the singular 'day' for a single logged day", () => {
    expect(buildNutritionSection(ctx({ ...FULL, loggedDaysCount: 1 }))).toContain("1 day logged");
  });

  it("omits target macros that are null", () => {
    const out = buildNutritionSection(
      ctx({ ...FULL, target: { calories: 2600, proteinG: 180, carbG: null, fatG: null } }),
    );
    expect(out).toContain("Daily target: 2600 kcal, 180g protein.");
    // The null carb/fat targets are dropped from the target line (the averages
    // line still mentions carbs, so assert on the target's specific values).
    expect(out).not.toContain("300g carbs");
    expect(out).not.toContain("75g fat");
  });

  it("renders the next planned session's fuelling target", () => {
    const out = buildNutritionSection(ctx({ ...FULL, nextSessionFuelling: NEXT_SESSION }));
    expect(out).toContain(
      "- Next planned session (2026-06-10, Strength, ~60 min at RPE 7): aim ~35g carbs beforehand, " +
        "then ~50g carbs + 25g protein to recover; estimated from the planned exercises.",
    );
    expect(out).not.toContain("&");
  });

  it("says no pre-fuelling is needed and omits the estimate note for athlete-set sessions", () => {
    const out = buildNutritionSection(
      ctx({
        ...FULL,
        nextSessionFuelling: { ...NEXT_SESSION, preCarbG: 0, estimated: false },
      }),
    );
    expect(out).toContain("no pre-fuelling needed");
    expect(out).not.toContain("estimated from the planned exercises");
  });

  it("omits the effort detail when duration and RPE are unknown", () => {
    const out = buildNutritionSection(
      ctx({
        ...FULL,
        nextSessionFuelling: { ...NEXT_SESSION, durationMin: null, rpe: null },
      }),
    );
    expect(out).toContain("- Next planned session (2026-06-10, Strength): aim ~35g carbs");
  });
});
