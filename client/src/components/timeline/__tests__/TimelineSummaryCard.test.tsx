import type { TimelineEntry, TrainingSummary } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimelineSummaryCard } from "../TimelineSummaryCard";

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getPlans: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    analytics: {
      getTrainingSummary: mocks.getSummary,
    },
    plans: {
      list: mocks.getPlans,
    },
  },
  QUERY_KEYS: {
    trainingSummary: ["/api/v1/training-overview", "summary"],
    plans: ["/api/v1/plans"],
  },
}));

const TODAY_ENTRY = {
  id: "day-1",
  date: "2026-05-20",
  status: "planned",
  focus: "Engine run",
  mainWorkout: "Easy 45 minute run",
} as unknown as TimelineEntry;

vi.mock("@/hooks/useAuth", () => ({
  useIsAuthUserLoaded: () => true,
}));

function renderSummary(
  selectedPlanId: string | null = "plan-1",
  timelineEntries: readonly TimelineEntry[] = [TODAY_ENTRY],
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineSummaryCard
        selectedPlanId={selectedPlanId}
        timelineEntries={timelineEntries}
        timelineLoading={false}
      />
    </QueryClientProvider>,
  );
}

function makeSummary(overrides: Partial<TrainingSummary> = {}): TrainingSummary {
  return {
    stationCoverage: [],
    currentStreak: 4,
    weeklyCompletedWorkouts: 3,
    weeklyGoal: 5,
    coverageLookbackDays: 180,
    ...overrides,
  };
}

describe("TimelineSummaryCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-20T12:00:00"));
    mocks.getSummary.mockResolvedValue(makeSummary());
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
  });

  it("names the coldest station once there is coverage to report", async () => {
    mocks.getSummary.mockResolvedValue(
      makeSummary({
        stationCoverage: [
          { station: "skierg", lastTrained: "2026-05-19", daysSince: 1 },
          { station: "sled_pull", lastTrained: "2026-04-27", daysSince: 23 },
        ],
      }),
    );
    renderSummary("plan-1");

    await waitFor(() => {
      expect(screen.getByTestId("station-radar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("station-radar-headline")).toHaveTextContent(
      "Sled Pull is coldest — 23d ago.",
    );
    expect(screen.getByTestId("station-radar-chip-skierg")).toHaveTextContent("SkiErg Yesterday");
  });

  it("words a station outside the coverage window as not covered, not never trained (P4)", async () => {
    mocks.getSummary.mockResolvedValue(
      makeSummary({
        stationCoverage: [
          { station: "skierg", lastTrained: "2026-05-19", daysSince: 1 },
          { station: "rowing", lastTrained: null, daysSince: null },
        ],
      }),
    );
    renderSummary("plan-1");

    await waitFor(() => {
      expect(screen.getByTestId("station-radar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("station-radar-headline")).toHaveTextContent(
      "Rowing has not been covered in the last 180 days.",
    );
    expect(screen.getByTestId("station-radar-chip-rowing")).toHaveTextContent("Not in 180d");
  });

  it("omits the radar entirely before any station has been trained", async () => {
    // The default fixture ships an empty stationCoverage.
    renderSummary("plan-1");

    await waitFor(() => {
      expect(screen.getByTestId("timeline-summary-card")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("station-radar")).not.toBeInTheDocument();
  });

  it("places the athlete in the selected plan's block", async () => {
    renderSummary("plan-1");

    await waitFor(() => {
      expect(screen.getByTestId("timeline-summary-card")).toBeInTheDocument();
    });

    // May 1 start, May 20 today => day 19 => week 3 of 8 => 38% => build.
    expect(screen.getByText("Week 3 of 8")).toBeInTheDocument();
    expect(screen.getByText("Build phase")).toBeInTheDocument();
  });

  it("omits the plan tile when the plan has no start date to measure from", async () => {
    mocks.getPlans.mockResolvedValue([
      {
        id: "plan-1",
        userId: "user-1",
        name: "HYROX build",
        sourceFileName: null,
        totalWeeks: 8,
        goal: null,
        startDate: null,
        endDate: "2026-05-30",
      },
    ]);

    renderSummary("plan-1");

    await waitFor(() => {
      expect(screen.getByTestId("timeline-summary-card")).toBeInTheDocument();
    });

    // Without a start date there is no honest week to report, so the card falls
    // back to its original four tiles rather than guessing week 1.
    expect(screen.queryByText(/^Week \d+ of \d+$/)).not.toBeInTheDocument();
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
    mocks.getSummary.mockResolvedValue(makeSummary({ currentStreak: 0, weeklyCompletedWorkouts: 0 }));
    mocks.getPlans.mockResolvedValue([]);

    renderSummary(null, []);

    await waitFor(() => {
      expect(screen.queryByTestId("timeline-summary-skeleton")).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId("timeline-summary-card")).not.toBeInTheDocument();
  });

});
