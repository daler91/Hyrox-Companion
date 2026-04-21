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
    expect(screen.getByTestId("workout-detail-focus-input")).toHaveValue("Upper Body Strength");
    expect(await screen.findByTestId("workout-stats-row")).toHaveTextContent("52");
    expect(await screen.findByTestId("exercise-table")).toBeInTheDocument();
    expect(screen.getByTestId("coach-take-panel")).toHaveTextContent(/softened 15%/i);
    await waitFor(() => {
      expect(screen.getByTestId("history-panel")).toHaveTextContent(/apr 2/i);
    });
  });

  it("renders Mark complete CTA and the plan-day exercise table when the workout hasn't been logged yet", async () => {
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

    expect(screen.getByTestId("workout-detail-mark-complete")).toBeInTheDocument();
    expect(screen.getByText(/tweak the sets above/i)).toBeInTheDocument();
    // Exercise table renders with plan-day-backed mutations — see the
    // +Add button used to append prescribed sets pre-log.
    expect(await screen.findByTestId("exercise-table")).toBeInTheDocument();
  });

  it("swaps the sidebar to the in-dialog coach chat when Ask coach is clicked", async () => {
    mockWorkouts.get.mockResolvedValue(
      makeWorkout({ exerciseSets: [makeSet()] }),
    );
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });

    renderDialog();

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
    mockWorkouts.update.mockResolvedValue(makeWorkout({ rpe: 8 }));

    renderDialog();

    const input = await screen.findByTestId("workout-stats-rpe-input");
    // Initial value reflects the server state.
    expect(input).toHaveValue(7);

    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "8");

    // Debounced save (500ms) eventually calls api.workouts.update with the new RPE.
    await waitFor(() => {
      expect(mockWorkouts.update).toHaveBeenCalledWith("log-1", { rpe: 8 });
    }, { timeout: 2000 });
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

  it("flushes pending cell PATCHes before firing the coach-note regenerate on Save", async () => {
    mockWorkouts.history.mockResolvedValue({
      lastSameFocus: null,
      prSetCount: 0,
      blockAvgRpe: null,
    });
    // Plan-day-backed set used by the inline editor.
    mockPlans.getDayExercises.mockResolvedValue([
      makeSet({ id: "plan-set-1", planDayId: "plan-day-1", workoutLogId: null, weight: 60 }),
    ]);
    mockPlans.updateDayExercise.mockResolvedValue(
      makeSet({ id: "plan-set-1", planDayId: "plan-day-1", workoutLogId: null, weight: 65 }),
    );
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

    // Wait for the plan-day exercise row then expand it so the
    // InlineSetEditor (and its per-field inputs) render.
    const toggle = await screen.findByTestId("exercise-row-toggle");
    const user = userEvent.setup();
    await user.click(toggle);
    const weightInput = await screen.findByTestId("input-weight-plan-set-1");

    // Drives the hook's debounced patch queue.
    await user.clear(weightInput);
    await user.type(weightInput, "65");

    // Click Save BEFORE the 350ms debounce fires — the pending patch is
    // still in the hook's ref map. `flushPendingSetPatches` has to fire
    // the PATCH synchronously, and the drain watcher has to wait for it
    // before firing regenerate.
    const saveBtn = screen.getByTestId("workout-detail-save-button");
    await user.click(saveBtn);

    // Both mutations land; asserting call order guards against a
    // regression where regenerate fires before the PATCH is even
    // enqueued (pre-fix behaviour — the cell's useDebouncedCallback
    // had no flush seam).
    await waitFor(() => {
      expect(mockPlans.updateDayExercise).toHaveBeenCalled();
      expect(mockPlans.regenerateCoachNote).toHaveBeenCalledWith("plan-day-1");
    });
    const patchOrder = mockPlans.updateDayExercise.mock.invocationCallOrder[0];
    const regenerateOrder = mockPlans.regenerateCoachNote.mock.invocationCallOrder[0];
    expect(patchOrder).toBeLessThan(regenerateOrder);
  });

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
