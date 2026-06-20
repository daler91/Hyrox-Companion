import type { MovementPatternCoverage, MuscleGroupCoverage, TrainingOverview } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  tsb: null,
  monotony: null,
  strain: null,
  monotonyZone: "ok" as const,
  trimp: null,
  tss: null,
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

const defaultMuscleCoverage: MuscleGroupCoverage[] = [
  { muscle: "chest", label: "Chest", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "shoulders", label: "Shoulders", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "rear_delts", label: "Rear delts", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "traps", label: "Traps", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "lats", label: "Lats", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "upper_back", label: "Upper back", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "biceps", label: "Biceps", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "triceps", label: "Triceps", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "forearms", label: "Forearms", bodyRegion: "upper", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "core", label: "Core", bodyRegion: "core", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "obliques", label: "Obliques", bodyRegion: "core", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "lower_back", label: "Lower back", bodyRegion: "core", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "hip_flexors", label: "Hip flexors", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "quads", label: "Quads", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "hamstrings", label: "Hamstrings", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "glutes", label: "Glutes", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "adductors", label: "Adductors", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "hip_abductors", label: "Hip abductors", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "calves", label: "Calves", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
  { muscle: "tibialis", label: "Tibialis", bodyRegion: "lower", sessionCount: 0, totalSets: 0, lastTrained: null, daysSince: null },
];

function makeOverview(overrides: Partial<TrainingOverview> = {}): TrainingOverview {
  return {
    weeklySummaries: [],
    workoutDates: [],
    categoryTotals: {},
    stationCoverage: [],
    movementPatternCoverage: defaultPatternCoverage,
    muscleGroupCoverage: defaultMuscleCoverage,
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

function applyCoverageOverrides<T, K extends string>(
  coverage: readonly T[],
  getKey: (item: T) => K,
  overrides: Partial<Record<K, Partial<T>>>,
): T[] {
  return coverage.map((item) => {
    const override = overrides[getKey(item)];
    return override ? { ...item, ...override } : { ...item };
  });
}

function expectTextContentGroup(element: HTMLElement, expectedTexts: readonly string[]) {
  for (const text of expectedTexts) {
    expect(element).toHaveTextContent(text);
  }
}

describe("CategoryBreakdownTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the no-data empty state when muscle coverage has no trained muscles", async () => {
    mocks.getTrainingOverview.mockResolvedValue(makeOverview());

    renderWithQueryClient(<CategoryBreakdownTab dateParams="range=90" />);

    expect(await screen.findByText(/training mix and coverage insights appear here/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Muscle Heat Map" })).not.toBeInTheDocument();
  });

  it("renders movement pattern coverage with counts and freshness", async () => {
    mocks.getTrainingOverview.mockResolvedValue(makeOverview({
      movementPatternCoverage: applyCoverageOverrides(defaultPatternCoverage, (pattern) => pattern.pattern, {
        squat: { sessionCount: 2, totalSets: 6, lastTrained: "2026-05-20", daysSince: 3 },
        hinge: { sessionCount: 1, totalSets: 3, lastTrained: "2026-05-12", daysSince: 11 },
        horizontal_push: { sessionCount: 2, totalSets: 8, lastTrained: "2026-05-18", daysSince: 5 },
      }),
    }));

    renderWithQueryClient(<CategoryBreakdownTab dateParams="from=2026-05-01&to=2026-05-23" />);

    expect(await screen.findByRole("heading", { name: "Movement Pattern Coverage" })).toBeInTheDocument();
    const analysis = screen.getByTestId("movement-pattern-analysis");
    expectTextContentGroup(analysis, [
      "3/10",
      "30% of movement patterns trained in this range.",
      "Horizontal push",
      "8 sets across 2 sessions.",
      "Vertical push",
      "it has no logged sessions in this range",
      "Push volume is leading pull volume.",
    ]);
    expect(screen.getByTestId("movement-pattern-next-focus")).toHaveTextContent(
      "Next focus: Add Vertical push; it has no logged sessions in this range.",
    );

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

  it("renders the muscle heat map silhouette and set-volume tiles", async () => {
    mocks.getTrainingOverview.mockResolvedValue(makeOverview({
      muscleGroupCoverage: applyCoverageOverrides(defaultMuscleCoverage, (muscle) => muscle.muscle, {
        quads: { sessionCount: 3, totalSets: 12, lastTrained: "2026-05-22", daysSince: 1 },
        chest: { sessionCount: 1, totalSets: 3, lastTrained: "2026-05-12", daysSince: 11 },
      }),
    }));

    renderWithQueryClient(<CategoryBreakdownTab dateParams="from=2026-05-01&to=2026-05-23" />);

    expect(await screen.findByRole("heading", { name: "Muscle Heat Map" })).toBeInTheDocument();
    const analysis = screen.getByTestId("muscle-heat-map-analysis");
    expectTextContentGroup(analysis, [
      "Lower body 80%",
      "Upper 20% / Core 0% / Lower 80% by set volume.",
      "Quads",
      "12 sets across 3 sessions.",
      "Shoulders",
      "it has no logged sets in this range",
      "Upper push volume is leading upper pull volume.",
      "Quad work volume is leading posterior chain volume.",
    ]);
    expect(screen.getByTestId("muscle-heat-map-next-focus")).toHaveTextContent(
      "Next focus: Add Shoulders; it has no logged sets in this range.",
    );

    expect(screen.getByTestId("muscle-heat-map-silhouette")).toBeInTheDocument();
    const grid = screen.getByTestId("muscle-heat-map-grid");
    expect(within(grid).getByRole("heading", { name: "Upper body" })).toBeInTheDocument();
    expect(within(grid).getByRole("heading", { name: "Core" })).toBeInTheDocument();
    expect(within(grid).getByRole("heading", { name: "Lower body" })).toBeInTheDocument();

    const quadsTile = screen.getByTestId("muscle-tile-quads");
    expect(quadsTile).toHaveTextContent("Quads");
    expect(quadsTile).toHaveTextContent("12 sets - 3 sessions");
    expect(quadsTile).toHaveTextContent("Yesterday");
    expect(quadsTile).toHaveTextContent("Peak set volume");

    const chestTile = screen.getByTestId("muscle-tile-chest");
    expect(chestTile).toHaveTextContent("Chest");
    expect(chestTile).toHaveTextContent("3 sets - 1 session");
    expect(chestTile).toHaveTextContent("11d ago");
  });

  it("renders empty pattern tiles when other breakdown data exists", async () => {
    mocks.getTrainingOverview.mockResolvedValue(makeOverview({
      categoryTotals: { strength: { count: 1, totalSets: 1 } },
      stationCoverage: [{ station: "skierg", lastTrained: "2026-05-20", daysSince: 3 }],
    }));

    renderWithQueryClient(<CategoryBreakdownTab dateParams="range=90" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Movement Pattern Coverage" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Functional Station Coverage" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("station-coverage-grid")).not.toBeInTheDocument();
    const movementGrid = screen.getByTestId("movement-pattern-coverage-grid");
    expect(within(movementGrid).getAllByText("Never trained")).toHaveLength(10);
    expect(within(movementGrid).getAllByText("0 sessions - 0 sets")).toHaveLength(10);
    expect(screen.getByRole("heading", { name: "Muscle Heat Map" })).toBeInTheDocument();
    expect(screen.getByTestId("muscle-tile-quads")).toHaveTextContent("0 sets - 0 sessions");
  });
});
