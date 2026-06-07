import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateText } from "../../ai/providers";
import { AppError } from "../../errors";
import { storage } from "../../storage";
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
});
