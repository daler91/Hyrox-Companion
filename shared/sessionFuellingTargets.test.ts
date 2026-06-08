import { describe, expect, it } from "vitest";

import { computeSessionFuellingTarget } from "./sessionFuellingTargets";

describe("computeSessionFuellingTarget", () => {
  it("scales carbs to a moderate 60-min session anchored to bodyweight", () => {
    const t = computeSessionFuellingTarget({ durationMin: 60, rpe: 6, bodyweightKg: 75 });
    expect(t).toMatchObject({ preCarbG: 30, postCarbG: 53, postProteinG: 23 });
    expect(t.reasonCodes).toEqual([]);
    expect(t.explanation).toContain("Guidance only");
  });

  it("skips pre-fuelling for a short, easy session", () => {
    const t = computeSessionFuellingTarget({ durationMin: 30, rpe: 3, bodyweightKg: 75 });
    expect(t.preCarbG).toBe(0);
    expect(t.postCarbG).toBe(16); // 75 * 0.7 * 0.6 * 0.5
    expect(t.reasonCodes).toContain("short_easy_no_pre");
    expect(t.explanation).toContain("no pre-fuelling needed");
  });

  it("recommends more carbs for a long, hard session", () => {
    const t = computeSessionFuellingTarget({ durationMin: 90, rpe: 9, bodyweightKg: 75 });
    expect(t.preCarbG).toBe(61); // 75 * 0.4 * 1.35 * 1.5
    expect(t.postCarbG).toBe(106); // 75 * 0.7 * 1.35 * 1.5
    expect(t.postProteinG).toBe(23);
  });

  it("falls back to absolute defaults when bodyweight is unknown", () => {
    const t = computeSessionFuellingTarget({ durationMin: 60, rpe: 6, bodyweightKg: null });
    expect(t).toMatchObject({ preCarbG: 30, postCarbG: 60, postProteinG: 25 });
    expect(t.reasonCodes).toContain("no_bodyweight_defaults");
  });

  it("assumes a moderate 60-min session when intensity/duration are unknown", () => {
    const t = computeSessionFuellingTarget({ durationMin: null, rpe: null, bodyweightKg: 75 });
    expect(t.reasonCodes).toContain("assumed_moderate_intensity");
    expect(t.reasonCodes).toContain("assumed_duration_60min");
    expect(t.postProteinG).toBe(23);
  });

  it("clamps post-session protein to a sensible per-meal range", () => {
    const light = computeSessionFuellingTarget({ durationMin: 60, rpe: 6, bodyweightKg: 50 });
    expect(light.postProteinG).toBe(20); // round(15) clamped up to 20
    expect(light.reasonCodes).toContain("post_protein_clamped");

    const heavy = computeSessionFuellingTarget({ durationMin: 60, rpe: 6, bodyweightKg: 150 });
    expect(heavy.postProteinG).toBe(40); // round(45) clamped down to 40
    expect(heavy.reasonCodes).toContain("post_protein_clamped");
  });
});
