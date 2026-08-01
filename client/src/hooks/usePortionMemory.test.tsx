import type { FoodWithPortionMemory } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { makeFood } from "@/test/factories/foodFactory";

import { usePortionMemory } from "./useNutrition";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      nutrition: { ...actual.api.nutrition, recent: vi.fn(), listFavorites: vi.fn() },
    },
  };
});

function remembered(overrides: Partial<FoodWithPortionMemory> = {}): FoodWithPortionMemory {
  return { ...makeFood(), lastQuantityG: null, lastMealType: null, ...overrides };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("usePortionMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the portion and meal a food was last logged in", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([
      remembered({ id: "f1", lastQuantityG: 140, lastMealType: "breakfast" }),
    ]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);

    const { result } = renderHook(() => usePortionMemory(), { wrapper });

    await waitFor(() =>
      expect(result.current("f1")).toEqual({ quantityG: 140, mealType: "breakfast" }),
    );
  });

  it("favourites win on a tie — a starred food is the one the athlete curated", async () => {
    // Same food surfaces in both lists (recently logged AND starred) with
    // different remembered portions; the favourites entry must win.
    vi.mocked(api.nutrition.recent).mockResolvedValue([
      remembered({ id: "f1", lastQuantityG: 80, lastMealType: "snack" }),
    ]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([
      remembered({ id: "f1", lastQuantityG: 140, lastMealType: "breakfast" }),
    ]);

    const { result } = renderHook(() => usePortionMemory(), { wrapper });

    await waitFor(() =>
      expect(result.current("f1")).toEqual({ quantityG: 140, mealType: "breakfast" }),
    );
  });

  it("returns undefined for a food that has never been logged", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([
      remembered({ id: "f1", lastQuantityG: 140, lastMealType: "breakfast" }),
    ]);
    // Starred but never logged: both memory fields are null, so it shouldn't
    // be added to the lookup at all.
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([remembered({ id: "f2" })]);

    const { result } = renderHook(() => usePortionMemory(), { wrapper });

    // Wait for the known food to resolve so the assertion below reflects
    // settled data rather than the empty initial map.
    await waitFor(() => expect(result.current("f1")).toBeDefined());
    expect(result.current("f2")).toBeUndefined();
    expect(result.current("unknown-id")).toBeUndefined();
  });
});
