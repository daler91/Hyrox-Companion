import type { ExerciseSet, TimelineEntry, WorkoutLog } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { WorkoutDetailDialogV2 } from "../WorkoutDetailDialogV2";

// The dialog fetches the workout + history on open and fires set-level
// mutations on edits. Mock every workouts-API call the component touches
// so tests run without a server.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: {
        ...actual.api.workouts,
        get: vi.fn(),
        history: vi.fn(),
        updateSet: vi.fn(),
        addSet: vi.fn(),
        deleteSet: vi.fn(),
        seedFromPlan: vi.fn(),
      },
    },
  };
});

const mockWorkouts = api.workouts as unknown as {
  get: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  addSet: ReturnType<typeof vi.fn>;
  deleteSet: ReturnType<typeof vi.fn>;
  seedFromPlan: ReturnType<typeof vi.fn>;
};

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "log-1",
    date: "2026-04-14",
    type: "logged",
    status: "completed",
    focus: "Upper Body Strength",
    mainWorkout: "4x8 back squat at 60kg",
    accessory: null,
    notes: "Felt good",
    workoutLogId: "log-1",
    duration: 52,
    rpe: 7,
    aiRationale: "Softened 15% from your Sunday sim. Keep it honest on the sled.",
    ...overrides,
  };
}

function makeWorkout(overrides: Partial<WorkoutLog & { exerciseSets?: ExerciseSet[] }> = {}) {
  return {
    id: "log-1",
    userId: "user-1",
    date: "2026-04-14",
    focus: "Upper Body Strength",
    mainWorkout: "4x8 back squat at 60kg",
    accessory: null,
    notes: "Felt good",
    duration: 52,
    rpe: 7,
    source: "manual",
    planDayId: null,
    planId: null,
    stravaActivityId: null,
    garminActivityId: null,
    calories: null,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    exerciseSets: [],
    ...overrides,
  } as WorkoutLog & { exerciseSets: ExerciseSet[] };
}

function makeSet(overrides: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id: "set-1",
    workoutLogId: "log-1",
    planDayId: null,
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: 8,
    weight: 60,
    distance: null,
    time: null,
    notes: null,
    confidence: 95,
    sortOrder: 0,
    ...overrides,
  };
}

function renderDialog(props: Partial<React.ComponentProps<typeof WorkoutDetailDialogV2>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkoutDetailDialogV2
        entry={makeEntry()}
        onClose={vi.fn()}
        onAskCoach={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("WorkoutDetailDialogV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the header, stats, exercise table and coach take panel", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet({ reps: 8, weight: 60 })] }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: { date: "2026-04-02", focus: "Upper Body Strength" },
      prSetCount: 3,
      blockAvgRpe: 7.2,
    });

    renderDialog();

    expect(await screen.findByTestId("workout-detail-dialog-v2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /upper body strength/i })).toBeInTheDocument();
    expect(await screen.findByTestId("workout-stats-row")).toHaveTextContent("52");
    expect(await screen.findByTestId("exercise-table")).toBeInTheDocument();
    expect(screen.getByTestId("coach-take-panel")).toHaveTextContent(/softened 15%/i);
    await waitFor(() => {
      expect(screen.getByTestId("history-panel")).toHaveTextContent(/apr 2/i);
    });
  });

  it("renders a placeholder when the workout hasn't been logged yet", () => {
    mockWorkouts.get.mockResolvedValue(makeWorkout());
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ workoutLogId: null, planDayId: "plan-1" }),
    });

    expect(screen.getByText(/mark it complete/i)).toBeInTheDocument();
  });

  it("invokes onAskCoach when the Ask coach button is clicked", async () => {
    const onAskCoach = vi.fn();
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()] }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({ onAskCoach });

    const user = userEvent.setup();
    const button = await screen.findByTestId("ask-coach-button");
    await user.click(button);
    expect(onAskCoach).toHaveBeenCalledTimes(1);
  });

  it("surfaces the AI-modified chip when the plan day has a rationale", async () => {
    mockWorkouts.get.mockResolvedValue(makeWorkout());
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ aiSource: "rag", aiRationale: "tweaked today's volume" }),
    });

    expect(await screen.findByTestId("ai-modified-chip")).toBeInTheDocument();
  });
});
