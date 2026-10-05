import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryBreakdownTab } from "../CategoryBreakdownTab";
import { CoachInsightsTab } from "../CoachInsightsTab";
import { ExerciseProgressionTab } from "../ExerciseProgressionTab";
import { FuellingTab } from "../FuellingTab";
import { MafTrendTab } from "../MafTrendTab";
import { PersonalRecordsTab } from "../PersonalRecordsTab";
import { TrainingOverviewTab } from "../TrainingOverviewTab";

const api = vi.hoisted(() => ({
  getTrainingOverview: vi.fn(),
  getPersonalRecords: vi.fn(),
  getExerciseAnalytics: vi.fn(),
  listMafTests: vi.fn(),
  getBlock: vi.fn(),
  listAnnotations: vi.fn(),
  getStoredCoachInsights: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: {
        ...actual.api.analytics,
        getTrainingOverview: api.getTrainingOverview,
        getPersonalRecords: api.getPersonalRecords,
        getExerciseAnalytics: api.getExerciseAnalytics,
      },
      mafTests: { ...actual.api.mafTests, list: api.listMafTests },
      nutrition: { ...actual.api.nutrition, getBlock: api.getBlock },
      timelineAnnotations: { ...actual.api.timelineAnnotations, list: api.listAnnotations },
      chat: { ...actual.api.chat, getStoredCoachInsights: api.getStoredCoachInsights },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

vi.mock("../training-overview/useOverviewAnalysis", () => ({
  useOverviewAnalysis: () => ({
    sections: null,
    hasAnalysis: false,
    isGenerating: false,
    generatedAt: null,
    stale: false,
    error: null,
    canGenerate: false,
    regenerate: vi.fn(),
  }),
}));

const SERVER_ERROR = new Error("500: Internal Server Error");

function renderTab(tab: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  return render(<QueryClientProvider client={client}>{tab}</QueryClientProvider>);
}

// Each tab's empty state is its own copy ("No workout data yet", "No personal
// records yet", ...); every one of them used to render for a failed fetch too.
const TABS = [
  {
    name: "training overview",
    render: () => <TrainingOverviewTab dateParams="" />,
    testId: "training-overview-error",
    emptyText: /No workout data yet/,
    fetcher: api.getTrainingOverview,
  },
  {
    name: "category breakdown",
    render: () => <CategoryBreakdownTab dateParams="" />,
    testId: "category-breakdown-error",
    emptyText: /training mix and coverage insights appear here/,
    fetcher: api.getTrainingOverview,
  },
  {
    name: "personal records",
    render: () => <PersonalRecordsTab dateParams="" />,
    testId: "personal-records-error",
    emptyText: /No personal records yet/,
    fetcher: api.getPersonalRecords,
  },
  {
    name: "exercise progression",
    render: () => <ExerciseProgressionTab dateParams="" />,
    testId: "exercise-progression-error",
    emptyText: /progression lines appear here/,
    fetcher: api.getPersonalRecords,
  },
  {
    name: "MAF trend",
    render: () => <MafTrendTab />,
    testId: "maf-trend-error",
    emptyText: /No MAF tests yet/,
    fetcher: api.listMafTests,
  },
  {
    name: "fuelling",
    render: () => <FuellingTab dateParams="" />,
    testId: "fuelling-tab-error",
    emptyText: /No nutrition logged in this range/,
    fetcher: api.getBlock,
  },
] as const;

describe("analytics tabs on a failed fetch (U5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getTrainingOverview.mockRejectedValue(SERVER_ERROR);
    api.getPersonalRecords.mockRejectedValue(SERVER_ERROR);
    api.getExerciseAnalytics.mockRejectedValue(SERVER_ERROR);
    api.listMafTests.mockRejectedValue(SERVER_ERROR);
    api.getBlock.mockRejectedValue(SERVER_ERROR);
    api.listAnnotations.mockResolvedValue([]);
    auth.user = null;
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it.each(TABS)("shows an error with a retry, not the empty state, for $name", async (tab) => {
    const user = userEvent.setup();
    renderTab(tab.render());

    expect(await screen.findByTestId(tab.testId)).toHaveAttribute("role", "alert");
    expect(screen.queryByText(tab.emptyText)).not.toBeInTheDocument();

    const callsBefore = tab.fetcher.mock.calls.length;
    await user.click(screen.getByTestId(`${tab.testId}-retry`));
    await waitFor(() => {
      expect(tab.fetcher.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // A retry of a query with no data resets it to pending, so `isError` and
  // `isRefetching` both read false while it runs: the card vanished for a
  // spinner, or for the empty state, and its "Retrying…" never showed.
  it.each(TABS)("keeps the error up, marked retrying, while a retry of $name runs", async (tab) => {
    const user = userEvent.setup();
    renderTab(tab.render());
    const retry = await screen.findByTestId(`${tab.testId}-retry`);

    tab.fetcher.mockReturnValue(
      new Promise(() => {
        // never settles
      }),
    );
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByTestId(`${tab.testId}-retry`)).toBeDisabled();
    });
    expect(screen.getByTestId(`${tab.testId}-retry`)).toHaveTextContent("Retrying…");
    expect(screen.queryByText(tab.emptyText)).not.toBeInTheDocument();
  });

  // TanStack pauses rather than runs a fetch while the browser is offline: the
  // query is pending but not `isLoading`, and not `isError` either, so every
  // tab fell through to its "nothing logged yet" state.
  it.each(TABS)(
    "shows loading, not the empty state, while the first $name fetch waits offline",
    async (tab) => {
      onlineManager.setOnline(false);
      renderTab(tab.render());

      expect(await screen.findByRole("status")).toHaveTextContent("Loading");
      expect(screen.queryByText(tab.emptyText)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(tab.fetcher).not.toHaveBeenCalled();

      act(() => {
        onlineManager.setOnline(true);
      });
      expect(await screen.findByTestId(tab.testId)).toBeInTheDocument();
    },
  );

  it("shows loading, not the Generate prompt, while the first coach insights fetch waits offline", async () => {
    auth.user = { id: "user-1" };
    api.getStoredCoachInsights.mockResolvedValue({ insights: "Keep building your aerobic base." });
    onlineManager.setOnline(false);
    renderTab(<CoachInsightsTab />);

    expect(await screen.findByText(/Reviewing your workouts/)).toBeInTheDocument();
    expect(screen.queryByText(/Generate a personalized analysis/)).not.toBeInTheDocument();

    act(() => {
      onlineManager.setOnline(true);
    });
    expect(await screen.findByTestId("text-coach-insights-content")).toHaveTextContent(
      "Keep building your aerobic base.",
    );
  });

  it("still shows the progression error when only the exercise analytics fetch failed", async () => {
    api.getPersonalRecords.mockResolvedValue({ "Back Squat": { category: "strength" } });
    renderTab(<ExerciseProgressionTab dateParams="" />);

    expect(await screen.findByTestId("exercise-progression-error")).toBeInTheDocument();
  });

  it("keeps the real empty state for a fetch that succeeded with nothing in it", async () => {
    api.getPersonalRecords.mockResolvedValue({});
    renderTab(<PersonalRecordsTab dateParams="" />);

    expect(await screen.findByText(/No personal records yet/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
