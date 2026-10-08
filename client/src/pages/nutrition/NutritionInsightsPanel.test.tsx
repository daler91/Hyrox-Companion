import type { NutritionInsightsResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { api } from "@/lib/api";

import { NutritionInsightsPanel } from "./NutritionInsightsPanel";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { getInsights: vi.fn(), regenerateInsights: vi.fn() } },
  QUERY_KEYS: { nutritionInsights: ["/api/v1/nutrition/insights"] },
}));

const auth = vi.hoisted(() => ({ user: { aiCoachEnabled: true } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <NutritionInsightsPanel />;
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation({ path: "/nutrition" }).hook}>{ui}</Router>
    </QueryClientProvider>,
  );
}

describe("NutritionInsightsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { aiCoachEnabled: true };
  });

  // U29 (CODEBASE_ANALYSIS_2026-10-03): the server 403s generation without
  // AI consent, so the button used to lead to "Please try again".
  it("disables Generate and links to Settings when the AI Coach is off", async () => {
    auth.user = { aiCoachEnabled: false };
    vi.mocked(api.nutrition.getInsights).mockResolvedValue({ insights: null });
    renderPanel();

    const notice = await screen.findByTestId("nutrition-insights-ai-off");
    expect(notice).toHaveTextContent(/AI Coach is turned off/);
    expect(screen.getByRole("link", { name: "Enable AI Coach" })).toHaveAttribute(
      "href",
      "/settings?tab=training",
    );
    expect(screen.getByTestId("button-generate-nutrition-insights")).toBeDisabled();
    expect(screen.queryByTestId("nutrition-insights-empty")).not.toBeInTheDocument();
  });

  it("explains a 403 AI_COACH_DISABLED instead of asking to try again", async () => {
    vi.mocked(api.nutrition.getInsights).mockRejectedValue(
      new Error('403: {"error":"AI coaching is disabled","code":"AI_COACH_DISABLED"}'),
    );
    renderPanel();

    const alert = await screen.findByTestId("text-nutrition-insights-error");
    expect(alert).toHaveTextContent(/Enable it in Settings/);
    expect(alert).not.toHaveTextContent(/try again/i);
  });

  it("shows an empty state with a Generate button when none are stored", async () => {
    vi.mocked(api.nutrition.getInsights).mockResolvedValue({ insights: null });
    renderPanel();

    expect(await screen.findByTestId("nutrition-insights-empty")).toBeInTheDocument();
    expect(screen.getByTestId("button-generate-nutrition-insights")).toHaveTextContent(
      "Generate insights",
    );
  });

  it("shows an inline error when fetching insights fails", async () => {
    vi.mocked(api.nutrition.getInsights).mockRejectedValue(new Error("network error"));
    renderPanel();

    expect(await screen.findByTestId("text-nutrition-insights-error")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/network|try again/i);
  });

  it("renders stored insights as markdown content with a Regenerate button", async () => {
    const data: NutritionInsightsResponse = {
      insights: "# Eat more protein on hard days",
      generatedAt: "2026-06-07T00:00:00.000Z",
      stale: false,
    };
    vi.mocked(api.nutrition.getInsights).mockResolvedValue(data);
    renderPanel();

    expect(await screen.findByTestId("nutrition-insights-content")).toHaveTextContent(
      "Eat more protein",
    );
    expect(screen.getByTestId("button-generate-nutrition-insights")).toHaveTextContent(
      "Regenerate",
    );
  });
});
