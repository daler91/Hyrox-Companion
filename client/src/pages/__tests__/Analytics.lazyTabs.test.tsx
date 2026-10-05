import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import Analytics from "../Analytics";

const reload = vi.hoisted(() => vi.fn());
const originalLocation = globalThis.location;

vi.mock("@/components/analytics/TrainingOverviewTab", () => ({
  TrainingOverviewTab: () => <div data-testid="training-overview-tab" />,
}));
// What a tab chunk a deploy removed does: its dynamic import rejects.
vi.mock("@/components/analytics/CoachInsightsTab", () => {
  throw new TypeError(
    "Failed to fetch dynamically imported module: /assets/CoachInsightsTab-0ld.js",
  );
});
// The range-scoped tabs take `dateParams`, which kept them on bare React.lazy
// while lazyWithReload was typed for prop-less pages.
vi.mock("@/components/analytics/CategoryBreakdownTab", () => {
  throw new TypeError(
    "Failed to fetch dynamically imported module: /assets/CategoryBreakdownTab-0ld.js",
  );
});
vi.mock("@/components/analytics/FuellingTab", () => {
  throw new TypeError("Failed to fetch dynamically imported module: /assets/FuellingTab-0ld.js");
});
vi.mock("@/lib/featureFlags", () => ({
  featureFlags: { emomBuilderEnabled: false, nutritionEnabled: true },
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/hooks/useUrlQueryState", () => ({
  useUrlQueryState: () => ["90", vi.fn()],
}));
vi.mock("@/lib/api", () => ({
  api: { analytics: { exportData: vi.fn() } },
  QUERY_KEYS: { preferences: ["preferences"] },
}));

installRadixPointerMocks();

function renderAnalytics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryDefaults(["preferences"], {
    queryFn: () => Promise.resolve({ weeklyGoal: 5 }),
  });
  queryClient.setQueryData(["preferences"], { weeklyGoal: 5 });
  return render(
    <QueryClientProvider client={queryClient}>
      <Analytics />
    </QueryClientProvider>,
  );
}

// The Analytics tabs are lazy chunks too. With bare React.lazy a tab whose
// chunk a deploy removed failed until the athlete reloaded by hand; through
// lazyWithReload it reloads the page onto the current build once.
// CL3 (CODEBASE_ANALYSIS_2026-10-03)
describe("Analytics lazy tabs", () => {
  beforeEach(() => {
    reload.mockReset();
    sessionStorage.clear();
    // wouter reads the path; the reload is what the test watches.
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { pathname: "/analytics", search: "", hash: "", reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
  });

  it.each([
    ["Coach Insights", "tab-coach-insights"],
    ["Breakdown", "tab-breakdown"],
    ["Fuelling", "tab-fuelling"],
  ])("reloads the page when the %s tab's chunk is gone", async (_name, tabTestId) => {
    const user = userEvent.setup();
    renderAnalytics();

    await user.click(screen.getByTestId(tabTestId));

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
