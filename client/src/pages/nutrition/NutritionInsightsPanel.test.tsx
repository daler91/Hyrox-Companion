import type { NutritionInsightsResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { NutritionInsightsPanel } from "./NutritionInsightsPanel";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { getInsights: vi.fn(), regenerateInsights: vi.fn() } },
  QUERY_KEYS: { nutritionInsights: ["/api/v1/nutrition/insights"] },
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <NutritionInsightsPanel />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("NutritionInsightsPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows an empty state with a Generate button when none are stored", async () => {
    vi.mocked(api.nutrition.getInsights).mockResolvedValue({ insights: null });
    renderPanel();

    expect(await screen.findByTestId("nutrition-insights-empty")).toBeInTheDocument();
    expect(screen.getByTestId("button-generate-nutrition-insights")).toHaveTextContent("Generate insights");
  });

  it("renders stored insights as markdown content with a Regenerate button", async () => {
    const data: NutritionInsightsResponse = {
      insights: "# Eat more protein on hard days",
      generatedAt: "2026-06-07T00:00:00.000Z",
      stale: false,
    };
    vi.mocked(api.nutrition.getInsights).mockResolvedValue(data);
    renderPanel();

    expect(await screen.findByTestId("nutrition-insights-content")).toHaveTextContent("Eat more protein");
    expect(screen.getByTestId("button-generate-nutrition-insights")).toHaveTextContent("Regenerate");
  });
});
