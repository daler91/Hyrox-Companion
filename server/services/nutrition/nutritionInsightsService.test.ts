import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateText } from "../../ai/providers";
import { AppError } from "../../errors";
import { storage } from "../../storage";
import { makeLogRow } from "./foodTestFixture";
import { generateNutritionInsights } from "./nutritionInsightsService";

vi.mock("../../ai/providers", () => ({ generateText: vi.fn() }));
vi.mock("../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    nutrition: {
      listEntriesWithFoodForDateRange: vi.fn(),
      getCurrentTarget: vi.fn(),
      listEntriesWithFoodForDate: vi.fn(),
    },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseLoadTags: vi.fn(),
    },
  },
}));

function aiText(text: string) {
  return { text } as Awaited<ReturnType<typeof generateText>>;
}

describe("generateNutritionInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "UTC" } as never);
    vi.mocked(storage.nutrition.listEntriesWithFoodForDateRange).mockResolvedValue([]);
    vi.mocked(storage.nutrition.getCurrentTarget).mockResolvedValue(undefined);
    vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([]);
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
    vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
    vi.mocked(storage.analytics.getExerciseLoadTags).mockResolvedValue([]);
  });

  it("returns the model's Markdown, calling the reasoning model on the nutrition_insights budget", async () => {
    vi.mocked(generateText).mockResolvedValue(aiText("# Insights\n- Eat more protein on hard days"));
    const result = await generateNutritionInsights("u1");

    expect(result.insights).toContain("Eat more protein");
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ modelRole: "reasoning", feature: "nutrition_insights", userId: "u1" }),
    );
  });

  it("throws an AppError on an empty AI response", async () => {
    vi.mocked(generateText).mockResolvedValue(aiText(""));
    await expect(generateNutritionInsights("u1")).rejects.toBeInstanceOf(AppError);
  });

  // C8 (CODEBASE_ANALYSIS_2026-10-03): the micro line names the finished day it
  // judged and says that coverage is partial.
  describe("micronutrient line", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const promptContent = () => {
      const request = vi.mocked(generateText).mock.calls.at(0)?.[0];
      return String(request?.messages.at(0)?.content ?? "");
    };

    it("judges the latest complete logged day and carries the coverage caveat", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-08T00:05:00Z"));
      vi.mocked(storage.nutrition.listEntriesWithFoodForDateRange).mockResolvedValue([
        makeLogRow({ logDate: "2026-06-07" }, { micros: { iron: 4 } }),
      ]);
      vi.mocked(generateText).mockResolvedValue(aiText("# Insights"));

      await generateNutritionInsights("u1");

      expect(promptContent()).toContain(
        "Micronutrients below 50% of reference intake on 2026-06-07 (the latest complete logged day): Iron 22%.",
      );
      expect(promptContent()).toContain("a low figure may be a data gap");
      expect(promptContent()).not.toContain("today");
    });

    // The all-clear carried the low-figure caveat ("a low figure may be a data
    // gap") when nothing was low; it needs its own hedge.
    it("hedges an all-clear without talking about a low figure", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-08T09:00:00Z"));
      vi.mocked(storage.nutrition.listEntriesWithFoodForDateRange).mockResolvedValue([
        makeLogRow({ logDate: "2026-06-07" }, { micros: { iron: 18 } }),
      ]);
      vi.mocked(generateText).mockResolvedValue(aiText("# Insights"));

      await generateNutritionInsights("u1");

      expect(promptContent()).toContain(
        "Micronutrients on 2026-06-07 (the latest complete logged day): all tracked micros are at or above 50% of reference intake.",
      );
      expect(promptContent()).toContain("an all-clear can still miss a gap");
      expect(promptContent()).not.toContain("low figure");
    });

    it("says no complete day was logged rather than 'no data today'", async () => {
      vi.mocked(generateText).mockResolvedValue(aiText("# Insights"));

      await generateNutritionInsights("u1");

      expect(promptContent()).toContain("Micronutrients: no complete day of food logged in this window.");
    });
  });
});
