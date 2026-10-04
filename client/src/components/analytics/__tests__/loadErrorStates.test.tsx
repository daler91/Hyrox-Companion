import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryBreakdownTab } from "../CategoryBreakdownTab";
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
}));

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
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

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
