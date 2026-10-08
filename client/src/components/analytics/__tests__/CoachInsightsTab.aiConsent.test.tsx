import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { CoachInsightsTab } from "../CoachInsightsTab";
import { OverviewAnalysisHeader } from "../training-overview/OverviewAnalysisHeader";

const getStoredCoachInsights = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: { id: "user-1", aiCoachEnabled: false } }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, chat: { ...actual.api.chat, getStoredCoachInsights } },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={memoryLocation({ path: "/analytics" }).hook}>{ui}</Router>
    </QueryClientProvider>,
  );
}

// U29 (CODEBASE_ANALYSIS_2026-10-03): with AI consent off (the default) the
// Generate buttons led to a 403 shown as "Please try again".
describe("AI analytics with the AI Coach off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: "user-1", aiCoachEnabled: false };
    getStoredCoachInsights.mockResolvedValue({ insights: null });
  });

  it("Coach Insights disables Generate and links to the Training settings", async () => {
    renderWithProviders(<CoachInsightsTab />);

    expect(await screen.findByTestId("coach-insights-ai-off")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enable AI Coach" })).toHaveAttribute(
      "href",
      "/settings?tab=training",
    );
    expect(screen.getByTestId("button-generate-coach-insights")).toBeDisabled();
  });

  it("Coach Insights keeps Generate enabled once the AI Coach is on", async () => {
    auth.user = { id: "user-1", aiCoachEnabled: true };
    renderWithProviders(<CoachInsightsTab />);

    expect(await screen.findByText(/Generate a personalized analysis/)).toBeInTheDocument();
    expect(screen.queryByTestId("coach-insights-ai-off")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-generate-coach-insights")).toBeEnabled();
  });

  it("the Overview analysis header shows the consent notice", () => {
    renderWithProviders(
      <OverviewAnalysisHeader
        hasAnalysis={false}
        isGenerating={false}
        error={null}
        canGenerate={false}
        aiCoachOff
        onGenerate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("overview-analysis-ai-off")).toBeInTheDocument();
    expect(screen.getByTestId("button-generate-overview-analysis")).toBeDisabled();
  });
});
