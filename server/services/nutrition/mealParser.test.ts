import type { Food } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../../ai/providers";
import { AppError } from "../../errors";
import { storage } from "../../storage";
import { type MealParseRaw, parseMealFromPhoto, parseMealFromText, resolveAndPreview } from "./mealParser";

vi.mock("../../ai/providers", () => ({ generateJsonText: vi.fn() }));
vi.mock("../../storage", () => ({
  storage: { nutrition: { searchLocalFoods: vi.fn() } },
}));

// Vision path: capture the generateContent request the parser builds (mirrors
// server/gemini/exerciseParser.image.test.ts). The mocked retryWithBackoff runs
// the fn so the spy is invoked with the constructed request; vi.hoisted keeps
// the spies reachable inside the hoisted vi.mock factory.
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

function aiText(payload: unknown) {
  // generateJsonText resolves a TextAiResponse; the parser only reads `.text`.
  return { text: JSON.stringify(payload) } as Awaited<ReturnType<typeof generateJsonText>>;
}

function makeFood(over: Partial<Food> = {}): Food {
  return {
    id: "f1",
    source: "usda",
    sourceId: "1",
    name: "Egg, scrambled",
    brand: null,
    createdByUserId: null,
    servingSizeG: null,
    caloriesPer100g: 150,
    proteinPer100g: 10,
    carbPer100g: 1,
    fatPer100g: 11,
    fiberPer100g: 0,
    micros: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("parseMealFromText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses well-formed items and warnings", async () => {
    vi.mocked(generateJsonText).mockResolvedValue(
      aiText({
        items: [
          { name: "egg, scrambled", quantityG: 100, displayAmount: "2 eggs", mealType: "breakfast", confidence: 92 },
          { name: "toast", quantityG: 30, displayAmount: "1 slice", confidence: 80 },
        ],
        warnings: ["assumed large eggs"],
      }),
    );

    const raw = await parseMealFromText("2 eggs and toast", "u1");
    expect(raw.items).toHaveLength(2);
    expect(raw.items[0]).toMatchObject({ name: "egg, scrambled", quantityG: 100, mealType: "breakfast" });
    expect(raw.warnings).toEqual(["assumed large eggs"]);
  });

  it("drops a malformed item but keeps the valid ones", async () => {
    vi.mocked(generateJsonText).mockResolvedValue(
      aiText({
        items: [
          { name: "banana", quantityG: 120, displayAmount: "1 banana", confidence: 88 },
          { name: "", quantityG: -5 }, // invalid: empty name + non-positive grams
        ],
        warnings: [],
      }),
    );

    const raw = await parseMealFromText("a banana", "u1");
    expect(raw.items).toHaveLength(1);
    expect(raw.items[0].name).toBe("banana");
  });

  it("defaults a missing displayAmount/confidence rather than dropping the row", async () => {
    vi.mocked(generateJsonText).mockResolvedValue(
      aiText({ items: [{ name: "rice", quantityG: 180 }], warnings: [] }),
    );
    const raw = await parseMealFromText("rice", "u1");
    expect(raw.items[0]).toMatchObject({ name: "rice", displayAmount: "rice", confidence: 50 });
  });

  it("throws an AppError on invalid JSON", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({ text: "not json" } as Awaited<ReturnType<typeof generateJsonText>>);
    await expect(parseMealFromText("x", "u1")).rejects.toBeInstanceOf(AppError);
  });

  it("throws an AppError on an empty response", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({ text: "" } as Awaited<ReturnType<typeof generateJsonText>>);
    await expect(parseMealFromText("x", "u1")).rejects.toBeInstanceOf(AppError);
  });
});

describe("parseMealFromPhoto", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the image as inlineData on the vision model and maps items like the text path", async () => {
    generateContentSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        items: [
          { name: "egg, scrambled", quantityG: 100, displayAmount: "2 eggs", mealType: "breakfast", confidence: 88 },
        ],
        warnings: ["portion estimated from the plate"],
      }),
    });

    const raw = await parseMealFromPhoto("ZmFrZS1pbWFnZQ==", "image/jpeg", "u1");

    expect(raw.items).toHaveLength(1);
    expect(raw.items[0]).toMatchObject({ name: "egg, scrambled", quantityG: 100, mealType: "breakfast" });
    expect(raw.warnings).toEqual(["portion estimated from the plate"]);

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
    expect(typeof callArgs.contents[0].parts[1].text).toBe("string");
    // Usage is tracked for the vision call (before any empty-response check).
    expect(trackUsageSpy).toHaveBeenCalledWith("u1", "gemini-2.5-flash", "parse", expect.anything());
  });

  it("drops malformed items but keeps the valid ones", async () => {
    generateContentSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        items: [
          { name: "banana", quantityG: 120, displayAmount: "1 banana", confidence: 80 },
          { name: "", quantityG: -1 },
        ],
        warnings: [],
      }),
    });
    const raw = await parseMealFromPhoto("ZmFrZQ==", "image/png", "u1");
    expect(raw.items).toHaveLength(1);
    expect(raw.items[0].name).toBe("banana");
  });

  it("throws an AppError on invalid JSON", async () => {
    generateContentSpy.mockResolvedValueOnce({ text: "not json" });
    await expect(parseMealFromPhoto("ZmFrZQ==", "image/jpeg", "u1")).rejects.toBeInstanceOf(AppError);
  });

  it("throws an AppError on an empty response", async () => {
    generateContentSpy.mockResolvedValueOnce({ text: "" });
    await expect(parseMealFromPhoto("ZmFrZQ==", "image/jpeg", "u1")).rejects.toBeInstanceOf(AppError);
  });
});

describe("resolveAndPreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attaches the matched food and a scaled macro preview", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([makeFood()]);
    const raw: MealParseRaw = {
      items: [{ name: "egg, scrambled", quantityG: 200, displayAmount: "4 eggs", mealType: "breakfast", confidence: 90 }],
      warnings: [],
    };

    const { items } = await resolveAndPreview(raw, "u1");
    expect(items[0].foodId).toBe("f1");
    expect(items[0].food?.name).toBe("Egg, scrambled");
    // 200g of a 150kcal/100g food = 300 kcal, 20g protein.
    expect(items[0].nutrition).toMatchObject({ calories: 300, protein: 20 });
  });

  it("leaves unmatched items with a null food and no preview", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([]);
    const raw: MealParseRaw = {
      items: [{ name: "obscure dish", quantityG: 100, displayAmount: "a plate", mealType: null, confidence: 40 }],
      warnings: ["portion unclear"],
    };

    const { items, warnings } = await resolveAndPreview(raw, "u1");
    expect(items[0].foodId).toBeNull();
    expect(items[0].food).toBeNull();
    expect(items[0].nutrition).toBeNull();
    expect(warnings).toEqual(["portion unclear"]);
  });
});
