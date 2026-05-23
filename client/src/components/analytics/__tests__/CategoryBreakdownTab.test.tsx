import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MovementPatternCoverage, TrainingOverview } from "@shared/schema";

import { CategoryBreakdownTab } from "../CategoryBreakdownTab";

const mocks = vi.hoisted(() => ({
  getTrainingOverview: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    analytics: {
      getTrainingOverview: mocks.getTrainingOverview,
    },
  },
}));

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

const defaultPatternCoverage: MovementPatternCoverage[] = [
  { pattern: "squat", label: "Squat pattern", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "hinge", label: "Hinge pattern", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "horizontal_push", label: "Horizontal push", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "vertical_push", label: "Vertical push", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "horizontal_pull", label: "Horizontal pull", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "vertical_pull", label: "Vertical pull", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "lunge_split_squat", label: "Lunge / split squat", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "carry", label: "Carry", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "core_flexion", label: "Core flexion", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { pattern: "core_anti_rotation", label: "Core anti-rotation", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
];

function makeOverview(overrides: Partial<TrainingOverview> = {}): TrainingOverview {
  return {
    weeklySummaries: [],
    workoutDates: [],
    categoryTotals: {},
    stationCoverage: [],
    movementPatternCoverage: defaultPatternCoverage,
    currentStreak: 0,
    weeklyCompletedWorkouts: 0,
    weeklyGoal: 5,
    currentStats: {
      totalWorkouts: 0,
      avgPerWeek: 0,
      totalDuration: 0,
      avgDuration: 0,
      avgRpe: null,
      avgCompliancePct: null,
    },
    trainingLoad: emptyTrainingLoad,
    ...overrides,
  };
}

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>,
  );
}

describe("CategoryBreakdownTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders movement pattern coverage with counts and freshness", async () => {
    mocks.getTrainingOverview.mockResolvedValue(makeOverview({
      movementPatternCoverage: defaultPatternCoverage.map((pattern) => {
        if (pattern.pattern === "squat") {
          return {
            ...pattern,
            sessionCount: 2,
            totalSets: 6,
            lastTrained: "2026-05-20",
            daysSince: 3,
          };
        }
        if (pattern.pattern === "hinge") {
          return {
            ...pattern,
            sessionCount: 1,
            totalSets: 3,
            lastTrained: "2026-05-12",
            daysSince: 11,
          };
        }
        return pattern;
      }),
    }));

    renderWithQueryClient(<CategoryBreakdownTab dateParams="from=2026-05-01&to=2026-05-23" />);

    expect(await screen.findByRole("heading", { name: "Movement Pattern Coverage" })).toBeInTheDocument();
    const grid = screen.getByTestId("movement-pattern-coverage-grid");
    expect(grid.children).toHaveLength(10);

    const squatTile = within(grid).getByText("Squat pattern").closest("[class*='rounded-lg']");
    expect(squatTile).not.toBeNull();
    expect(squatTile).toHaveTextContent("3d ago");
    expect(squatTile).toHaveTextContent("2 sessions - 6 sets");

    const hingeTile = within(grid).getByText("Hinge pattern").closest("[class*='rounded-lg']");
    expect(hingeTile).not.toBeNull();
    expect(hingeTile).toHaveTextContent("11d ago");
    expect(hingeTile).toHaveTextContent("1 session - 3 sets");
    expect(mocks.getTrainingOverview).toHaveBeenCalledWith("from=2026-05-01&to=2026-05-23");
  });

  it("renders empty pattern tiles when other breakdown data exists", async () => {
    mocks.getTrainingOverview.mockResolvedValue(makeOverview({
      stationCoverage: [{ station: "skierg", lastTrained: "2026-05-20", daysSince: 3 }],
    }));

    renderWithQueryClient(<CategoryBreakdownTab dateParams="range=90" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Movement Pattern Coverage" })).toBeInTheDocument();
    });
    expect(screen.getAllByText("Never trained")).toHaveLength(10);
    expect(screen.getAllByText("0 sessions - 0 sets")).toHaveLength(10);
  });
});
