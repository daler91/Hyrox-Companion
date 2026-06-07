import type { FoodLogEntryWithNutrition, NutritionMacroTotals, SessionFuellingResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { FuellingAroundSessionPanel } from "./FuellingAroundSessionPanel";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { getSessionFuelling: vi.fn() } },
  QUERY_KEYS: {
    nutritionSessionFuelling: (id: string) => ["/api/v1/nutrition/session-fuelling", id],
  },
}));

const ZERO: NutritionMacroTotals = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };

function makeEntry(id: string): FoodLogEntryWithNutrition {
  return {
    id,
    foodId: "f1",
    name: "Banana",
    brand: null,
    loggedAt: "2026-06-07T11:00:00.000Z",
    logDate: "2026-06-07",
    quantityG: 100,
    mealType: "pre_workout",
    entryMethod: "manual",
    nutrition: { calories: 100, protein: 10, carb: 20, fat: 5, fiber: 2 },
  };
}

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("FuellingAroundSessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows pre/post totals when entries exist (start-time windows)", async () => {
    const data: SessionFuellingResponse = {
      workoutId: "w1",
      date: "2026-06-07",
      usedStartTime: true,
      pre: [makeEntry("e1")],
      post: [makeEntry("e2"), makeEntry("e3")],
      preTotals: { calories: 200, protein: 20, carb: 40, fat: 10, fiber: 4 },
      postTotals: { calories: 300, protein: 30, carb: 50, fat: 12, fiber: 5 },
    };
    vi.mocked(api.nutrition.getSessionFuelling).mockResolvedValue(data);

    renderWithClient(<FuellingAroundSessionPanel workoutLogId="w1" />);

    expect(await screen.findByTestId("fuelling-pre-totals")).toHaveTextContent("200");
    expect(screen.getByTestId("fuelling-post-totals")).toHaveTextContent("30");
    expect(screen.queryByTestId("fuelling-fallback-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fuelling-empty")).not.toBeInTheDocument();
  });

  it("shows the meal-tag fallback note when no start time was used", async () => {
    const data: SessionFuellingResponse = {
      workoutId: "w1",
      date: "2026-06-07",
      usedStartTime: false,
      pre: [makeEntry("e1")],
      post: [],
      preTotals: { calories: 100, protein: 10, carb: 20, fat: 5, fiber: 2 },
      postTotals: ZERO,
    };
    vi.mocked(api.nutrition.getSessionFuelling).mockResolvedValue(data);

    renderWithClient(<FuellingAroundSessionPanel workoutLogId="w1" />);

    expect(await screen.findByTestId("fuelling-fallback-note")).toBeInTheDocument();
  });

  it("shows an empty state when nothing was logged around the session", async () => {
    const data: SessionFuellingResponse = {
      workoutId: "w1",
      date: "2026-06-07",
      usedStartTime: true,
      pre: [],
      post: [],
      preTotals: ZERO,
      postTotals: ZERO,
    };
    vi.mocked(api.nutrition.getSessionFuelling).mockResolvedValue(data);

    renderWithClient(<FuellingAroundSessionPanel workoutLogId="w1" />);

    expect(await screen.findByTestId("fuelling-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("fuelling-pre-totals")).not.toBeInTheDocument();
  });
});
