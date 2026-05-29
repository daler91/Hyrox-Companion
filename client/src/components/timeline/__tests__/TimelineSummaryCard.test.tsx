import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimelineSummaryCard } from "../TimelineSummaryCard";

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getPlans: vi.fn(),
  getTimeline: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    analytics: {
      getTrainingOverview: mocks.getOverview,
    },
    plans: {
      list: mocks.getPlans,
    },
    timeline: {
      get: mocks.getTimeline,
    },
  },
  QUERY_KEYS: {
    trainingOverview: ["/api/v1/training-overview"],
    plans: ["/api/v1/plans"],
    timeline: ["/api/v1/timeline"],
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useIsAuthUserLoaded: () => true,
}));

function renderSummary(selectedPlanId: string | null = "plan-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineSummaryCard selectedPlanId={selectedPlanId} />
    </QueryClientProvider>,
  );
}

const emptyTrainingLoad = {
  currentUtss: 0,
  acuteAvg: 0,
  chronicAvg: 0,
  acwr: null,
  zone: "insufficient_data" as const,
  flaggedVectors: [],
  activeRestrictions: [],
  downshiftRationale: null,
  trend: [],
};

describe("TimelineSummaryCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-20T12:00:00"));
    mocks.getOverview.mockResolvedValue({
      weeklySummaries: [],
      workoutDates: [],
      categoryTotals: {},
      stationCoverage: [],
      movementPatternCoverage: [],
      muscleGroupCoverage: [],
      currentStats: {
        totalWorkouts: 12,
        avgPerWeek: 3,
        totalDuration: 480,
        avgDuration: 40,
        avgRpe: 7,
        avgCompliancePct: null,
      },
      currentStreak: 4,
      weeklyCompletedWorkouts: 3,
      weeklyGoal: 5,
      trainingLoad: emptyTrainingLoad,
    });
    mocks.getPlans.mockResolvedValue([
      {
        id: "plan-1",
        userId: "user-1",
        name: "HYROX build",
        sourceFileName: null,
        totalWeeks: 8,
        goal: null,
        startDate: "2026-05-01",
        endDate: "2026-05-30",
      },
    ]);
    mocks.getTimeline.mockResolvedValue([
      {
        id: "day-1",
        date: "2026-05-20",
        status: "planned",
        focus: "Engine run",
        mainWorkout: "Easy 45 minute run",
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows today's session, weekly progress, streak, and race countdown", async () => {
    renderSummary("plan-1");

    expect(screen.getByTestId("timeline-summary-skeleton")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("timeline-summary-card")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "This Week" })).toBeInTheDocument();
    expect(screen.getByText("Engine run")).toBeInTheDocument();
    expect(screen.getByText("Easy 45 minute run")).toBeInTheDocument();
    expect(screen.getByText("3 of 5 this week")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Weekly workout progress" })).toHaveAttribute(
      "aria-valuetext",
      "3 of 5 workouts completed this week",
    );
    expect(screen.getByText("4 days")).toBeInTheDocument();
    expect(screen.getByText("Race day in 10 days")).toBeInTheDocument();
    expect(mocks.getTimeline).toHaveBeenCalledWith("plan-1");
  });

  it("counts down to the explicit race date rather than the plan end date", async () => {
    mocks.getPlans.mockResolvedValue([
      {
        id: "plan-1",
        userId: "user-1",
        name: "HYROX build",
        sourceFileName: null,
        totalWeeks: 8,
        goal: null,
        startDate: "2026-05-01",
        endDate: "2026-05-30",
        raceDate: "2026-06-15",
      },
    ]);

    renderSummary("plan-1");

    await waitFor(() => {
      expect(screen.getByTestId("timeline-summary-card")).toBeInTheDocument();
    });

    // raceDate (Jun 15, 26 days out) wins over endDate (May 30, which would be 10 days).
    expect(screen.getByText("Race day in 26 days")).toBeInTheDocument();
  });

  it("renders nothing when there is no plan, timeline, or workout data", async () => {
    mocks.getOverview.mockResolvedValue({
      weeklySummaries: [],
      workoutDates: [],
      categoryTotals: {},
      stationCoverage: [],
      movementPatternCoverage: [],
      muscleGroupCoverage: [],
      currentStats: {
        totalWorkouts: 0,
        avgPerWeek: 0,
        totalDuration: 0,
        avgDuration: 0,
        avgRpe: null,
        avgCompliancePct: null,
      },
      currentStreak: 0,
      weeklyCompletedWorkouts: 0,
      weeklyGoal: 5,
      trainingLoad: emptyTrainingLoad,
    });
    mocks.getPlans.mockResolvedValue([]);
    mocks.getTimeline.mockResolvedValue([]);

    renderSummary(null);

    await waitFor(() => {
      expect(screen.queryByTestId("timeline-summary-skeleton")).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId("timeline-summary-card")).not.toBeInTheDocument();
  });

  it("tolerates overview responses without current stats", async () => {
    mocks.getOverview.mockResolvedValue({
      weeklySummaries: [],
      workoutDates: [],
      categoryTotals: {},
      stationCoverage: [],
      movementPatternCoverage: [],
      muscleGroupCoverage: [],
      currentStreak: 0,
      weeklyCompletedWorkouts: 0,
      weeklyGoal: 5,
    });
    mocks.getPlans.mockResolvedValue([]);
    mocks.getTimeline.mockResolvedValue([]);

    renderSummary(null);

    await waitFor(() => {
      expect(screen.queryByTestId("timeline-summary-skeleton")).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId("timeline-summary-card")).not.toBeInTheDocument();
  });
});
