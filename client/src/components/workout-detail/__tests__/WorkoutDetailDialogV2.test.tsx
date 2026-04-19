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
        reparse: vi.fn(),
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
  reparse: ReturnType<typeof vi.fn>;
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

  // ---- Lazy-parse hydration ---------------------------------------------

  it("calls seed-from-plan then reparse when a plan-linked workout opens with no sets", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [], planDayId: "plan-day-1" }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });
    mockWorkouts.seedFromPlan.mockResolvedValue({ seededCount: 0 });
    mockWorkouts.reparse.mockResolvedValue({
      exercises: [],
      saved: false,
      setCount: 0,
    });

    renderDialog({
      entry: makeEntry({ mainWorkout: "4 rounds: 1000m SkiErg, 20 wall balls" }),
    });

    // Seed-from-plan fires first; when its promise settles, the onSettled
    // chain calls reparse. We don't assert on the transient hydrating
    // banner because mocked mutations resolve synchronously and the
    // isHydrating window collapses faster than React renders.
    await waitFor(() => {
      expect(mockWorkouts.seedFromPlan).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockWorkouts.reparse).toHaveBeenCalledTimes(1);
    });
  });

  it("skips seed-from-plan and calls reparse directly for ad-hoc logged workouts", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [], planDayId: null }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });
    mockWorkouts.reparse.mockResolvedValue({
      exercises: [],
      saved: false,
      setCount: 0,
    });

    renderDialog({
      entry: makeEntry({ planDayId: null, mainWorkout: "5x5 bench press at 80kg" }),
    });

    await waitFor(() => {
      expect(mockWorkouts.reparse).toHaveBeenCalledTimes(1);
    });
    expect(mockWorkouts.seedFromPlan).not.toHaveBeenCalled();
  });

  it("does not hydrate when the workout already has structured sets", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()] }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog();

    // Wait for the initial workout query to resolve. No hydration banner
    // should ever render because the exercise table has rows.
    await screen.findByTestId("exercise-table");
    expect(screen.queryByTestId("workout-detail-hydrating")).not.toBeInTheDocument();
    expect(mockWorkouts.seedFromPlan).not.toHaveBeenCalled();
    expect(mockWorkouts.reparse).not.toHaveBeenCalled();
  });

  it("skips reparse when the workout has no free text to parse", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [], planDayId: null }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: null, mainWorkout: "", accessory: null }),
    });

    // The hydration useEffect should bail early — there's nothing to
    // feed to parseExercisesFromText.
    await waitFor(() => {
      // Wait a tick so the effect has a chance to fire.
      expect(mockWorkouts.get).toHaveBeenCalled();
    });
    expect(mockWorkouts.reparse).not.toHaveBeenCalled();
    expect(mockWorkouts.seedFromPlan).not.toHaveBeenCalled();
  });

  // ---- Status change ---------------------------------------------------

  it("offers status-change items on the status chip dropdown and fires onChangeStatus", async () => {
    const onChangeStatus = vi.fn();
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()], planDayId: "plan-day-1" }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: "plan-day-1", status: "completed" }),
      onChangeStatus,
    });

    const user = userEvent.setup();
    // The chip is now the primary entry point — no need to open ⋮ first.
    await user.click(await screen.findByTestId("workout-detail-status-chip"));

    // The current status (completed) should NOT appear; all others should.
    expect(screen.queryByTestId("workout-detail-status-completed")).not.toBeInTheDocument();
    expect(screen.getByTestId("workout-detail-status-planned")).toBeInTheDocument();
    expect(screen.getByTestId("workout-detail-status-skipped")).toBeInTheDocument();
    expect(screen.getByTestId("workout-detail-status-missed")).toBeInTheDocument();

    await user.click(screen.getByTestId("workout-detail-status-skipped"));

    await waitFor(() => {
      expect(onChangeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: "log-1", planDayId: "plan-day-1" }),
        "skipped",
      );
    });
  });

  it("renders status chip as a non-interactive pill for ad-hoc logged workouts", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()], planDayId: null }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: null }),
      onChangeStatus: vi.fn(),
      onDelete: vi.fn(),
    });

    const user = userEvent.setup();
    // Chip renders but isn't a dropdown trigger for ad-hoc workouts.
    const chip = await screen.findByTestId("workout-detail-status-chip");
    expect(chip.tagName).toBe("SPAN");

    // Delete still lives in the ⋮ menu (which no longer carries status
    // items but does carry Delete for ad-hoc logged workouts).
    await user.click(screen.getByTestId("workout-detail-actions-trigger"));
    expect(screen.queryByTestId("workout-detail-status-planned")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workout-detail-status-skipped")).not.toBeInTheDocument();
    expect(screen.getByTestId("workout-detail-delete")).toBeInTheDocument();
  });

  // ---- Planned-entry state --------------------------------------------

  it("renders the Mark complete CTA for planned entries and hides stats + history", () => {
    const onMarkComplete = vi.fn();

    renderDialog({
      entry: makeEntry({
        workoutLogId: null,
        status: "planned",
        planDayId: "plan-day-1",
      }),
      onMarkComplete,
    });

    expect(screen.getByTestId("workout-detail-planned-cta")).toBeInTheDocument();
    expect(screen.getByTestId("workout-detail-mark-complete")).toBeInTheDocument();
    // Stats/history/athlete-note are workout-log-backed; they shouldn't
    // surface for a planned entry with nothing logged yet.
    expect(screen.queryByTestId("workout-stats-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("athlete-note-input")).not.toBeInTheDocument();
    // Planned entries open the prescription accordion by default.
    expect(screen.getByTestId("coach-prescription-collapsible")).toBeInTheDocument();
    // The workout query should not even have been issued — there's no
    // workoutId to fetch.
    expect(mockWorkouts.get).not.toHaveBeenCalled();
  });

  it("fires onMarkComplete when the CTA is clicked", async () => {
    const onMarkComplete = vi.fn();
    renderDialog({
      entry: makeEntry({
        workoutLogId: null,
        status: "planned",
        planDayId: "plan-day-1",
      }),
      onMarkComplete,
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("workout-detail-mark-complete"));

    expect(onMarkComplete).toHaveBeenCalledWith(
      expect.objectContaining({ workoutLogId: null, planDayId: "plan-day-1" }),
    );
  });

  it("offers Combine in the ⋮ menu for logged workouts only", async () => {
    const onCombine = vi.fn();
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()] }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({ onCombine });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workout-detail-actions-trigger"));
    await user.click(screen.getByTestId("workout-detail-combine"));
    expect(onCombine).toHaveBeenCalledTimes(1);
  });
});
