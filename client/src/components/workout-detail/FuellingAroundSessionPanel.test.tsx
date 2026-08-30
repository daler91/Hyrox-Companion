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

const setLocationSpy = vi.hoisted(() => vi.fn());
vi.mock("wouter", () => ({ useLocation: () => ["/", setLocationSpy] }));

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
    // Per-100g source for the entry, the raw input the server scales (audit M22).
    per100g: { caloriesPer100g: 89, proteinPer100g: 1.1, carbPer100g: 22.8, fatPer100g: 0.3, fiberPer100g: 2.6 },
    nutrition: { calories: 100, protein: 10, carb: 20, fat: 5, fiber: 2 },
  };
}

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeSessionFuelling(over: Partial<SessionFuellingResponse> = {}): SessionFuellingResponse {
  return {
    workoutId: "w1",
    date: "2026-06-07",
    usedStartTime: true,
    pre: [],
    post: [],
    preTotals: ZERO,
    postTotals: ZERO,
    ...over,
  };
}

function makeTarget(
  over: Partial<NonNullable<SessionFuellingResponse["target"]>> = {},
): NonNullable<SessionFuellingResponse["target"]> {
  return {
    preCarbG: 30,
    postCarbG: 60,
    postProteinG: 25,
    reasonCodes: [],
    explanation: "Guidance only.",
    ...over,
  };
}

/** Resolve the fuelling query with `data` and render the panel for w1. */
function renderPanel(data: SessionFuellingResponse) {
  vi.mocked(api.nutrition.getSessionFuelling).mockResolvedValue(data);
  renderWithClient(<FuellingAroundSessionPanel workoutLogId="w1" />);
}

describe("FuellingAroundSessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows pre/post totals when entries exist (start-time windows)", async () => {
    renderPanel(
      makeSessionFuelling({
        pre: [makeEntry("e1")],
        post: [makeEntry("e2"), makeEntry("e3")],
        preTotals: { calories: 200, protein: 20, carb: 40, fat: 10, fiber: 4 },
        postTotals: { calories: 300, protein: 30, carb: 50, fat: 12, fiber: 5 },
      }),
    );

    expect(await screen.findByTestId("fuelling-pre-totals")).toHaveTextContent("200");
    expect(screen.getByTestId("fuelling-post-totals")).toHaveTextContent("30");
    expect(screen.queryByTestId("fuelling-fallback-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fuelling-empty")).not.toBeInTheDocument();
  });

  it("shows the meal-tag fallback note when no start time was used", async () => {
    renderPanel(
      makeSessionFuelling({
        usedStartTime: false,
        pre: [makeEntry("e1")],
        preTotals: { calories: 100, protein: 10, carb: 20, fat: 5, fiber: 2 },
      }),
    );

    expect(await screen.findByTestId("fuelling-fallback-note")).toBeInTheDocument();
  });

  it("shows the per-group empty hint and the session targets when nothing is logged", async () => {
    renderPanel(
      makeSessionFuelling({
        target: makeTarget(),
        gap: { preCarbG: 30, postCarbG: 60, postProteinG: 25 },
      }),
    );

    // Targets are shown even when nothing is logged yet (what to aim for).
    expect(await screen.findByTestId("fuelling-post-target")).toHaveTextContent("60g");
    expect(screen.getAllByText("Nothing logged").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("fuelling-pre-totals")).not.toBeInTheDocument();
  });

  it("shows the session fuelling targets and the remaining gap", async () => {
    renderPanel(
      makeSessionFuelling({
        pre: [makeEntry("e1")],
        post: [makeEntry("e2")],
        preTotals: { calories: 100, protein: 5, carb: 18, fat: 2, fiber: 1 },
        postTotals: { calories: 200, protein: 15, carb: 30, fat: 5, fiber: 2 },
        target: makeTarget({ postCarbG: 80 }),
        gap: { preCarbG: 12, postCarbG: 50, postProteinG: 10 },
      }),
    );

    expect(await screen.findByTestId("fuelling-pre-target")).toHaveTextContent("12g to go");
    const post = screen.getByTestId("fuelling-post-target");
    expect(post).toHaveTextContent("80g");
    expect(post).toHaveTextContent("10g to go");
    expect(screen.getByTestId("fuelling-guidance")).toBeInTheDocument();
  });

  it("offers a log-recovery-meal deep link while post-session fuel is still owed", async () => {
    renderPanel(
      makeSessionFuelling({
        target: makeTarget(),
        gap: { preCarbG: 30, postCarbG: 60, postProteinG: 25 },
      }),
    );

    const button = await screen.findByTestId("button-log-recovery-meal");
    button.click();
    expect(setLocationSpy).toHaveBeenCalledWith("/nutrition?date=2026-06-07&meal=post_workout");
  });

  it("drops the recovery-meal link once the post-session gap is covered", async () => {
    renderPanel(
      makeSessionFuelling({
        pre: [makeEntry("e1")],
        post: [makeEntry("e2")],
        preTotals: { calories: 100, protein: 5, carb: 18, fat: 2, fiber: 1 },
        postTotals: { calories: 400, protein: 30, carb: 80, fat: 10, fiber: 3 },
        target: makeTarget({ postCarbG: 80 }),
        gap: { preCarbG: 12, postCarbG: 0, postProteinG: 0 },
      }),
    );

    await screen.findByTestId("fuelling-post-target");
    expect(screen.queryByTestId("button-log-recovery-meal")).not.toBeInTheDocument();
  });
});
