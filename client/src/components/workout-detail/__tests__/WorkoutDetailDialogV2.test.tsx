import type { ExerciseSet, TimelineEntry, WorkoutLog } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { WorkoutDetailDialogV2 } from "../WorkoutDetailDialogV2";

let showAdherenceInsights = true;

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({
    weightUnit: "kg" as const,
    distanceUnit: "km" as const,
    showAdherenceInsights,
  }),
}));

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
        update: vi.fn(),
        updateSet: vi.fn(),
        addSet: vi.fn(),
        deleteSet: vi.fn(),
        seedFromPlan: vi.fn(),
        reparse: vi.fn(),
      },
      plans: {
        ...actual.api.plans,
        getDayExercises: vi.fn().mockResolvedValue([]),
        addDayExercise: vi.fn(),
        updateDayExercise: vi.fn(),
        updateDayWithoutPlan: vi.fn(),
        deleteDayExercise: vi.fn(),
        regenerateCoachNote: vi.fn(),
      },
    },
  };
});

const mockWorkouts = api.workouts as unknown as {
  get: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  addSet: ReturnType<typeof vi.fn>;
  deleteSet: ReturnType<typeof vi.fn>;
  seedFromPlan: ReturnType<typeof vi.fn>;
  reparse: ReturnType<typeof vi.fn>;
};

const mockPlans = api.plans as unknown as {
  regenerateCoachNote: ReturnType<typeof vi.fn>;
  getDayExercises: ReturnType<typeof vi.fn>;
  updateDayExercise: ReturnType<typeof vi.fn>;
  updateDayWithoutPlan: ReturnType<typeof vi.fn>;
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
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
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
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("WorkoutDetailDialogV2", () => {
  beforeEach(() => {
    showAdherenceInsights = true;
    vi.clearAllMocks();
    mockPlans.updateDayWithoutPlan.mockResolvedValue({});
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
    expect(screen.getByTestId("workout-detail-focus-input")).toHaveValue("Upper Body Strength");
    expect(await screen.findByTestId("workout-stats-row")).toHaveTextContent("52");
    expect(await screen.findByTestId("exercise-table")).toBeInTheDocument();
    expect(screen.getByTestId("coach-take-panel")).toHaveTextContent(/softened 15%/i);
    await waitFor(() => {
      expect(screen.getByTestId("history-panel")).toHaveTextContent(/apr 2/i);
    });
  });

  it("renders Log workout CTA and the plan-day exercise table when the workout hasn't been logged yet", async () => {
    mockWorkouts.get.mockResolvedValue(makeWorkout());
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ workoutLogId: null, planDayId: "plan-1" }),
      onMarkComplete: vi.fn(),
    });

    // Both CTAs render: the body-level card and the sticky footer button.
    // The slimmed planned-overview no longer shows the planned exercise
    // table or the stats grid — those live inside step 1 of the stepper
    // now, which only renders after the user clicks Log workout.
    expect(screen.getByTestId("workout-detail-log-workout")).toBeInTheDocument();
    expect(screen.getByTestId("workout-detail-log-cta-button")).toBeInTheDocument();
    expect(screen.queryByTestId("exercise-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("planned-overview-summary")).not.toBeInTheDocument();
  });

  it("swaps the sidebar to the in-dialog coach chat when Ask coach is clicked", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()] }),
    );
    mockPlans.getDayExercises.mockResolvedValue([
      makeSet({ id: "plan-set-1", workoutLogId: null, planDayId: "plan-1", exerciseName: "back_squat", setNumber: 1 }),
      makeSet({ id: "plan-set-2", workoutLogId: null, planDayId: "plan-1", exerciseName: "walking_lunge", setNumber: 1 }),
    ]);
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: "plan-1", workoutLogId: "log-1" }),
    });

    const user = userEvent.setup();
    // Coach Take panel visible by default.
    expect(await screen.findByTestId("coach-take-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("in-dialog-coach-chat")).not.toBeInTheDocument();

    await user.click(await screen.findByTestId("ask-coach-button"));

    // Sidebar now shows the in-dialog chat; Coach Take + History
    // panels yield the space to the thread + input.
    expect(await screen.findByTestId("in-dialog-coach-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("coach-take-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-chat-message")).toHaveDisplayValue(/compliance was/i);

    // Back button restores Coach Take + History.
    await user.click(screen.getByTestId("in-dialog-coach-chat-back"));
    expect(await screen.findByTestId("coach-take-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("in-dialog-coach-chat")).not.toBeInTheDocument();
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

  it("shows prescribed snapshot text in logged Reference/Notes when available", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({
        mainWorkout: "Athlete edited description",
        prescribedMainWorkout: "Coach original prescription",
        exerciseSets: [makeSet()],
      }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ mainWorkout: "Athlete edited description", notes: null }),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("coach-prescription-toggle"));

    expect(await screen.findByText("Coach original prescription")).toBeInTheDocument();
    expect(screen.queryByText("Athlete edited description")).not.toBeInTheDocument();
  });

  it("shows a diff note when logged workout text was edited after completion", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({
        mainWorkout: "Athlete edited description",
        accessory: "Different accessory",
        notes: null,
        prescribedMainWorkout: "Coach original prescription",
        prescribedAccessory: "Coach accessory",
        prescribedNotes: null,
        exerciseSets: [makeSet()],
      }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ mainWorkout: "Athlete edited description", notes: null }),
    });

    expect(await screen.findByTestId("logged-prescription-diff-note")).toHaveTextContent(
      /Updated after completion: .*Main/i,
    );
  });

  it("shows planned-vs-actual set summary for plan-linked logged workouts", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({
        planDayId: "plan-1",
        exerciseSets: [makeSet({ exerciseName: "back_squat", setNumber: 1 })],
      }),
    );
    mockPlans.getDayExercises.mockResolvedValue([
      makeSet({ id: "plan-set-1", workoutLogId: null, planDayId: "plan-1", exerciseName: "back_squat", setNumber: 1 }),
      makeSet({ id: "plan-set-2", workoutLogId: null, planDayId: "plan-1", exerciseName: "walking_lunge", setNumber: 1 }),
    ]);
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: "plan-1", workoutLogId: "log-1" }),
    });

    expect(await screen.findByTestId("planned-actual-summary")).toHaveTextContent(
      "Planned vs Actual: 2 planned sets, 1 logged set, 1 removed",
    );
    expect(screen.getByTestId("planned-actual-summary")).toHaveTextContent(
      "Compliance: 50% (1/2 planned sets matched)",
    );
    expect(screen.getByTestId("planned-actual-summary")).toHaveTextContent("Low adherence");
    expect(screen.getByTestId("planned-actual-summary")).toHaveTextContent(
      "Removed: walking lunge ×1",
    );
  });

  it("shows adherence in the History panel for logged workouts when available", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({
        compliancePct: 82,
        exerciseSets: [makeSet()],
      }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: { date: "2026-04-01", focus: "Upper Body Strength" },
      prSetCount: 2,
      blockAvgRpe: 7.4,
    });

    renderDialog();

    expect(await screen.findByTestId("history-panel")).toHaveTextContent("Adherence");
    await waitFor(() => {
      expect(screen.getByTestId("history-panel")).toHaveTextContent("82%");
    });
  });

  it("hides adherence UI when adherence insights are disabled", async () => {
    showAdherenceInsights = false;
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({
        planDayId: "plan-1",
        compliancePct: 82,
        exerciseSets: [makeSet({ id: "actual-1", setNumber: 1 })],
      }),
    );
    mockPlans.getDayExercises.mockResolvedValue([
      makeSet({ id: "plan-set-1", workoutLogId: null, planDayId: "plan-1", setNumber: 1 }),
      makeSet({ id: "plan-set-2", workoutLogId: null, planDayId: "plan-1", setNumber: 2 }),
    ]);
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: "plan-1", workoutLogId: "log-1" }),
    });

    await screen.findByTestId("history-panel");
    expect(screen.queryByTestId("planned-actual-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-adherence")).not.toBeInTheDocument();
  });

  // ---- Lazy-parse hydration ---------------------------------------------
  //
  // The auto-hydration path (seed-from-plan + reparse on first open) was
  // removed when exercise_sets became the source of truth: plans generated
  // after the structured-exercises refactor always have prescribed rows on
  // the plan_day, and Mark Complete seeds the workout_log at log time. The
  // Parse button in CoachPrescriptionCollapsible is the explicit path for
  // legacy free-text-only rows. These tests lock in the "no silent fetch"
  // invariant so the silent-parse never comes back.

  it("never auto-fires seed-from-plan or reparse on open (plan-linked, no sets)", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [], planDayId: "plan-day-1" }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ mainWorkout: "4 rounds: 1000m SkiErg, 20 wall balls" }),
    });

    await waitFor(() => {
      expect(mockWorkouts.get).toHaveBeenCalled();
    });
    expect(mockWorkouts.seedFromPlan).not.toHaveBeenCalled();
    expect(mockWorkouts.reparse).not.toHaveBeenCalled();
    expect(screen.queryByTestId("workout-detail-hydrating")).not.toBeInTheDocument();
  });

  it("never auto-fires reparse on open (ad-hoc workout, no sets)", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [], planDayId: null }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: null, mainWorkout: "5x5 bench press at 80kg" }),
    });

    await waitFor(() => {
      expect(mockWorkouts.get).toHaveBeenCalled();
    });
    expect(mockWorkouts.reparse).not.toHaveBeenCalled();
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

  it("renders the Log workout CTA for planned entries and hides stats + history", () => {
    const onMarkComplete = vi.fn();

    renderDialog({
      entry: makeEntry({
        workoutLogId: null,
        status: "planned",
        planDayId: "plan-day-1",
      }),
      onMarkComplete,
    });

    // Body-level CTA card is the focal element; footer button is the
    // backup. Planned exercise table, stats grid, sidebar Coach Take +
    // History are all hidden — they only return inside step 1/2 of the
    // stepper or on the logged-state view.
    expect(screen.getByTestId("workout-detail-log-cta-button")).toBeInTheDocument();
    expect(screen.getByTestId("workout-detail-log-workout")).toBeInTheDocument();
    expect(screen.queryByTestId("workout-detail-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("planned-overview-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workout-stats-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coach-take-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("athlete-note-input")).not.toBeInTheDocument();
    // Prescription accordion is rendered (collapsed by default for the
    // slimmed planned-overview).
    expect(screen.getByTestId("coach-prescription-collapsible")).toBeInTheDocument();
    // The workout query should not even have been issued — there's no
    // workoutId to fetch.
    expect(mockWorkouts.get).not.toHaveBeenCalled();
  });

  it("fires onMarkComplete and opens the in-dialog stepper when Log workout is clicked", async () => {
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
    await user.click(screen.getByTestId("workout-detail-log-workout"));

    expect(onMarkComplete).toHaveBeenCalledWith(
      expect.objectContaining({ workoutLogId: null, planDayId: "plan-day-1" }),
    );
    // Stepper opens immediately on click; the planned→logged dialog
    // re-render is handled by the timeline cache patch in
    // logWorkoutMutation.onSuccess so we just assert the in-dialog
    // surface here.
    expect(screen.getByTestId("workout-logging-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("workout-logging-step-1")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("workout-logging-step-continue")).toBeInTheDocument();
  });

  it("keeps the logging stepper open when a plan day rebinds to its logged workout", async () => {
    const onMarkComplete = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const plannedEntry = makeEntry({
      id: "plan-plan-day-1",
      type: "planned",
      status: "planned",
      workoutLogId: null,
      planDayId: "plan-day-1",
    });
    const loggedEntry = makeEntry({
      id: "log-logged-workout-1",
      type: "logged",
      status: "completed",
      workoutLogId: "logged-workout-1",
      planDayId: "plan-day-1",
    });
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({
        id: "logged-workout-1",
        planDayId: "plan-day-1",
        exerciseSets: [makeSet({ id: "set-logged", workoutLogId: "logged-workout-1" })],
      }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkoutDetailDialogV2
          entry={plannedEntry}
          onClose={vi.fn()}
          onMarkComplete={onMarkComplete}
        />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("workout-detail-log-cta-button"));
    expect(screen.getByTestId("workout-logging-stepper")).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkoutDetailDialogV2
          entry={loggedEntry}
          onClose={vi.fn()}
          onMarkComplete={onMarkComplete}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workout-logging-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("workout-logging-step-1")).toHaveAttribute("aria-current", "step");

    await user.click(screen.getByTestId("workout-logging-step-continue"));
    expect(screen.getByTestId("workout-logging-step-2")).toHaveAttribute("aria-current", "step");
    expect(await screen.findByTestId("workout-stats-rpe-focus-panel")).toBeInTheDocument();
    expect(screen.getByTestId("workout-stats-rpe-input")).toBeInTheDocument();
    expect(screen.getByTestId("athlete-note-input")).toHaveAttribute("data-emphasis", "reflect");
    expect(screen.getByLabelText(/athlete note/i)).toBeEnabled();
  });

  it("clears the logging stepper when the dialog switches to a different owner", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const firstEntry = makeEntry({
      id: "plan-plan-day-1",
      type: "planned",
      status: "planned",
      workoutLogId: null,
      planDayId: "plan-day-1",
    });
    const secondEntry = makeEntry({
      id: "plan-plan-day-2",
      type: "planned",
      status: "planned",
      workoutLogId: null,
      planDayId: "plan-day-2",
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkoutDetailDialogV2
          entry={firstEntry}
          onClose={vi.fn()}
          onMarkComplete={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("workout-detail-log-cta-button"));
    expect(screen.getByTestId("workout-logging-stepper")).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkoutDetailDialogV2
          entry={secondEntry}
          onClose={vi.fn()}
          onMarkComplete={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("workout-logging-stepper")).not.toBeInTheDocument();
    });
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

  // ---- RPE inline edit -----------------------------------------------

  it("surfaces an editable RPE input for logged workouts and persists edits", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()], rpe: 7 }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });
    let resolveRpeUpdate: (workout: ReturnType<typeof makeWorkout>) => void = () => {};
    mockWorkouts.update.mockImplementation(
      () => new Promise((resolve) => {
        resolveRpeUpdate = resolve;
      }),
    );

    renderDialog();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("workout-stats-rpe-review"));

    const input = await screen.findByTestId("workout-stats-rpe-input");
    // Initial value reflects the server state.
    expect(input).toHaveValue(7);

    await user.clear(input);
    await user.type(input, "8");

    // Debounced save (500ms) eventually calls api.workouts.update with the new RPE.
    await waitFor(() => {
      expect(mockWorkouts.update).toHaveBeenCalledWith("log-1", { rpe: 8 });
    }, { timeout: 2000 });

    await act(async () => {
      resolveRpeUpdate(makeWorkout({ exerciseSets: [makeSet()], rpe: 8 }));
    });

    expect(screen.getByTestId("workout-stats-rpe-input")).toHaveValue(8);
    expect(screen.queryByTestId("workout-stats-rpe-review")).not.toBeInTheDocument();
  });

  it("keeps the RPE cell read-only for planned entries", () => {
    renderDialog({
      entry: makeEntry({
        workoutLogId: null,
        status: "planned",
        planDayId: "plan-day-1",
      }),
      onMarkComplete: vi.fn(),
    });

    // Planned entries don't have a workoutLog to save to — the stats
    // row isn't rendered at all, so the editable input is absent.
    expect(screen.queryByTestId("workout-stats-rpe-input")).not.toBeInTheDocument();
  });

  // ---- Save button ---------------------------------------------------

  it("triggers a coach-take regenerate when Save is clicked on a plan-day entry", async () => {
    mockWorkouts.get.mockResolvedValue(makeWorkout());
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });
    mockPlans.regenerateCoachNote.mockResolvedValue({
      planDayId: "plan-day-1",
      aiRationale: "Updated take.",
      aiNoteUpdatedAt: new Date().toISOString(),
    });

    renderDialog({
      entry: makeEntry({
        workoutLogId: null,
        status: "planned",
        planDayId: "plan-day-1",
      }),
      onMarkComplete: vi.fn(),
    });

    const saveBtn = await screen.findByTestId("workout-detail-save-button");
    expect(saveBtn).toHaveAccessibleName(/save/i);

    const user = userEvent.setup();
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockPlans.regenerateCoachNote).toHaveBeenCalledWith("plan-day-1");
    });
  });

  it("flashes a Saved confirmation without calling regenerate for ad-hoc logged workouts", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()] }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    // Ad-hoc entry has no planDayId — regenerate has nothing to update.
    renderDialog({ entry: makeEntry({ planDayId: null }) });

    const saveBtn = await screen.findByTestId("workout-detail-save-button");
    const user = userEvent.setup();
    await user.click(saveBtn);

    await screen.findByTestId("workout-detail-save-flash");
    expect(mockPlans.regenerateCoachNote).not.toHaveBeenCalled();
  });

  // The legacy "flushes pending cell PATCHes before firing the coach-note
  // regenerate on Save" test drove cell edits on the planned-overview's
  // exercise table. The slimmed planned-overview no longer renders that
  // table — cell editing only happens inside the stepper's step 1, which
  // doesn't expose a "Save prescription" button. The flush-before-
  // regenerate codepath itself is unchanged in handleWorkoutDetailSaveClick
  // (planSets.flushPendingSetPatches is still called before startSaveCycle).

  it("does not regenerate the coach note for a logged workout that happens to be plan-linked", async () => {
    // Guards the P1 fix: edits on a LOGGED workout (even one linked to
    // a plan day) go through api.workouts.*, not plan_days, so firing
    // regenerateCoachNote on Save would burn AI budget / cooldown for
    // a plan day whose content didn't change.
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()], planDayId: "plan-day-1" }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog({
      entry: makeEntry({ planDayId: "plan-day-1" }),
    });

    const saveBtn = await screen.findByTestId("workout-detail-save-button");
    const user = userEvent.setup();
    await user.click(saveBtn);

    await screen.findByTestId("workout-detail-save-flash");
    expect(mockPlans.regenerateCoachNote).not.toHaveBeenCalled();
  });

  it("clears the Saved confirmation when the dialog switches to a different entry", async () => {
    // Guards the P2 fix: `saveClickedAt` is dialog-level state. The
    // dialog stays mounted across entry switches, so without the
    // entry-id sentinel a prior save's "Saved ✓" confirmation bleeds
    // onto the next entry the athlete opens.
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()] }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkoutDetailDialogV2
          entry={makeEntry({ id: "log-A", planDayId: null })}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    const saveBtn = await screen.findByTestId("workout-detail-save-button");
    await user.click(saveBtn);
    await screen.findByTestId("workout-detail-save-flash");

    // Simulate the Timeline swapping in a different entry while the
    // dialog stays mounted.
    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkoutDetailDialogV2
          entry={makeEntry({ id: "log-B", planDayId: null })}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId("workout-detail-save-flash")).not.toBeInTheDocument();
  });
});
