import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../errors";
import { parseNutritionLabel } from "./labelParser";

// Vision path: capture the generateContent request the parser builds (mirrors
// mealParser.test.ts). The mocked retryWithBackoff runs the fn so the spy is
// invoked with the constructed request; vi.hoisted keeps the spies reachable
// inside the hoisted vi.mock factory.
const { generateContentSpy, trackUsageSpy } = vi.hoisted(() => ({
  generateContentSpy: vi.fn(),
  trackUsageSpy: vi.fn(),
}));
vi.mock("../../gemini/client", () => ({
  GEMINI_VISION_MODEL: "gemini-2.5-flash",
  getAiClient: () => ({ models: { generateContent: generateContentSpy } }),
  retryWithBackoff: (fn: (signal?: AbortSignal) => Promise<unknown>) => fn(),
  trackUsageFromResponse: trackUsageSpy,
}));

function aiJson(payload: unknown) {
  generateContentSpy.mockResolvedValueOnce({ text: JSON.stringify(payload) });
}

const PER_100G_LABEL = {
  productName: "Crunchy Peanut Butter",
  brand: "Pip & Nut",
  servingSizeText: "1 tbsp (15g)",
  servingSizeG: 15,
  energyUnit: "kcal",
  per100g: { calories: 601, protein: 28, carb: 12, fat: 51, fiber: 6 },
  perServing: null,
  confidence: 95,
  warnings: [],
};

describe("parseNutritionLabel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the image as inlineData on the vision model and maps a per-100g label", async () => {
    aiJson(PER_100G_LABEL);

    const result = await parseNutritionLabel("ZmFrZS1pbWFnZQ==", "image/jpeg", "u1");

    expect(result.label).toMatchObject({
      productName: "Crunchy Peanut Butter",
      brand: "Pip & Nut",
      servingSizeG: 15,
      basis: "per100g",
      confidence: 95,
    });
    expect(result.suggestion).toEqual({
      name: "Crunchy Peanut Butter",
      brand: "Pip & Nut",
      caloriesPer100g: 601,
      proteinPer100g: 28,
      carbPer100g: 12,
      fatPer100g: 51,
      fiberPer100g: 6,
      servingSizeG: 15,
    });
    expect(result.warnings).toEqual([]);

    // The request carries the base64 under inlineData on the vision model with a JSON contract.
    expect(generateContentSpy).toHaveBeenCalledTimes(1);
    const callArgs = generateContentSpy.mock.calls[0][0] as {
      model: string;
      config: { responseMimeType: string };
      contents: { parts: ({ inlineData?: { mimeType: string; data: string }; text?: string })[] }[];
    };
    expect(callArgs.model).toBe("gemini-2.5-flash");
    expect(callArgs.config.responseMimeType).toBe("application/json");
    expect(callArgs.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: "ZmFrZS1pbWFnZQ==" },
    });
    // Usage is tracked for the vision call (before any empty-response check).
    expect(trackUsageSpy).toHaveBeenCalledWith("u1", "gemini-2.5-flash", "parse", expect.anything());
  });

  it("prefers the per-100g column and reports basis 'both' when both are printed", async () => {
    aiJson({
      ...PER_100G_LABEL,
      perServing: { calories: 90, protein: 4.2, carb: 1.8, fat: 7.7, fiber: 0.9 },
    });

    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    expect(result.label?.basis).toBe("both");
    expect(result.suggestion?.caloriesPer100g).toBe(601);
    expect(result.warnings).toEqual([]);
  });

  it("converts a kJ-only label to kcal with a warning", async () => {
    aiJson({
      ...PER_100G_LABEL,
      energyUnit: "kJ",
      per100g: { ...PER_100G_LABEL.per100g, calories: 2514 },
    });

    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    // 2514 kJ / 4.184 ≈ 600.9 kcal
    expect(result.suggestion?.caloriesPer100g).toBeCloseTo(600.9, 1);
    expect(result.warnings).toContain("Energy was printed in kJ and converted to kcal.");
  });

  it("derives per-100g from a per-serving-only label when the serving weight is printed", async () => {
    aiJson({
      ...PER_100G_LABEL,
      servingSizeG: 50,
      per100g: null,
      perServing: { calories: 200, protein: 10, carb: 5, fat: 15, fiber: null },
    });

    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    expect(result.label?.basis).toBe("perServing");
    expect(result.suggestion).toMatchObject({
      caloriesPer100g: 400,
      proteinPer100g: 20,
      carbPer100g: 10,
      fatPer100g: 30,
      fiberPer100g: null, // not printed → stays blank, no invented value
    });
    expect(result.warnings).toContain(
      "Per-100g values were derived from the printed per-serving column.",
    );
  });

  it("leaves the suggestion macros empty when a per-serving-only label has no gram weight", async () => {
    aiJson({
      ...PER_100G_LABEL,
      servingSizeText: "1 bar",
      servingSizeG: null,
      per100g: null,
      perServing: { calories: 200, protein: 10, carb: 5, fat: 15, fiber: 2 },
    });

    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    // Never assume a serving is 100 g — the printed values stay on the label
    // for read-only display and the user fills per-100g by hand.
    expect(result.suggestion).toMatchObject({
      name: "Crunchy Peanut Butter",
      caloriesPer100g: null,
      proteinPer100g: null,
      carbPer100g: null,
      fatPer100g: null,
      fiberPer100g: null,
    });
    expect(result.label?.perServing).toMatchObject({ calories: 200, protein: 10 });
    expect(result.warnings.some((w) => w.includes("entered manually"))).toBe(true);
  });

  it("nulls implausible per-100g values instead of failing the save later", async () => {
    aiJson({
      ...PER_100G_LABEL,
      per100g: { calories: 601, protein: 2800, carb: 12, fat: 51, fiber: 6 },
    });

    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    expect(result.suggestion?.proteinPer100g).toBeNull();
    expect(result.suggestion?.caloriesPer100g).toBe(601);
    expect(result.warnings).toContain("Some values looked implausible for 100 g and were left blank.");
  });

  it("salvages garbled optional fields instead of dropping the payload", async () => {
    aiJson({
      ...PER_100G_LABEL,
      brand: 42, // garbled → null
      confidence: "very sure", // garbled → 50
      warnings: "not an array", // garbled → []
    });

    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    expect(result.label).toMatchObject({ brand: null, confidence: 50 });
    expect(result.suggestion?.caloriesPer100g).toBe(601);
  });

  it("returns label: null for the no-readable-label sentinel", async () => {
    aiJson({ label: null });
    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    expect(result).toEqual({ label: null, suggestion: null, warnings: [] });
  });

  it("returns label: null when no macro column was transcribed", async () => {
    aiJson({ ...PER_100G_LABEL, per100g: null, perServing: null });
    const result = await parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1");
    expect(result).toEqual({ label: null, suggestion: null, warnings: [] });
  });

  it("throws an AppError on invalid JSON", async () => {
    generateContentSpy.mockResolvedValueOnce({ text: "not json" });
    await expect(parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1")).rejects.toBeInstanceOf(AppError);
  });

  it("throws an AppError on an empty response", async () => {
    generateContentSpy.mockResolvedValueOnce({ text: "" });
    await expect(parseNutritionLabel("ZmFrZQ==", "image/jpeg", "u1")).rejects.toBeInstanceOf(AppError);
  });
});
