import type { StructureBlockInput, TimelineEntry } from "@shared/schema";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { StepLinkMove } from "@/components/workout-structure";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { ReviewSurface } from "../ReviewSurface";
import {
  expectWorkoutTitleRename,
  renameWorkoutTitleFromHeader,
} from "./workoutTitleTestHelpers";

const mockUseWorkoutDetail = vi.fn();
let showAdherenceInsights = true;
/** null = the athlete doesn't train to a MAF ceiling, which is the common case. */
let mafCeiling: number | null = null;
const RENDER_TIMEOUT_MS = 10_000;

installRadixPointerMocks();

vi.mock("@/hooks/useWorkoutDetail", () => ({
  useWorkoutDetail: (workoutId: string | null) => mockUseWorkoutDetail(workoutId),
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({
    weightUnit: "kg",
    distanceUnit: "km",
    showAdherenceInsights,
  }),
}));

vi.mock("@/hooks/useMafCeiling", () => ({ useMafCeiling: () => mafCeiling }));

// This suite renders ExerciseTable without a QueryClientProvider. The "last
// time" line is not what it is testing; an empty history is the no-op case.
vi.mock("@/hooks/useExerciseHistory", () => ({
  useExerciseHistory: () => ({ data: undefined }),
}));

// Same reason: the "Did it do its job?" card reads its grade through react-query.
// SessionGradeCard.test.tsx covers the card; here it renders nothing.
vi.mock("@/hooks/useSessionGrades", () => ({ useWorkoutSessionGrade: () => ({ data: undefined }) }));
vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/components/RpeSelector", () => ({
  RpeSelector: ({ suggestedValue }: { suggestedValue?: number | null }) => (
    <div data-testid="rpe-selector" data-suggested-value={suggestedValue ?? ""} />
  ),
}));

const structureEditor = vi.hoisted(() => ({
  props: undefined as
    | {
        onChange: (next: StructureBlockInput[], moves: readonly StepLinkMove[]) => unknown;
        saveDebounceMs?: number;
      }
    | undefined,
}));

vi.mock("@/components/workout-structure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/workout-structure")>()),
  StructureBlocksEditor: (props: NonNullable<typeof structureEditor.props>) => {
    structureEditor.props = props;
    return <div data-testid="structure-blocks-editor" />;
  },
}));

vi.mock("../shared/WorkoutPlanDayPicker", () => ({
  WorkoutPlanDayPicker: ({
    planId,
    planDayId,
    onChange,
  }: {
    planId: string | null;
    planDayId: string | null;
    onChange: (next: { planId: string | null; planDayId: string | null }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-plan-picker"
      data-plan-id={planId ?? ""}
      data-plan-day-id={planDayId ?? ""}
      onClick={() => onChange({ planId: "plan-9", planDayId: "day-9" })}
    >
      plan picker
    </button>
  ),
}));

// The fuelling panel is a data-fetching child (useSessionFuelling → useQuery)
// with its own suite; this file renders ReviewSurface without a QueryClient,
// so the panel is stubbed out the same way the other data-bound siblings are.
vi.mock("../FuellingAroundSessionPanel", () => ({
  FuellingAroundSessionPanel: () => null,
}));

vi.mock("../AthleteNoteInput", () => ({
  AthleteNoteInput: () => <textarea aria-label="Athlete note" />,
}));

// Self-contained child with its own auth/query dependencies (covered by
// mafTrend.helpers.test). Stub it out so these composition tests don't need a
// QueryClientProvider — it renders nothing for non-MAF users in any case.
vi.mock("../MafTestTagSection", () => ({
  MafTestTagSection: () => null,
}));

afterAll(() => {
  vi.unstubAllGlobals();
});

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-05-06",
    status: "completed",
    source: "manual",
    focus: "Strength",
    mainWorkout: "Logged text",
    accessory: null,
    notes: null,
    workoutLogId: "workout-1",
    planDayId: "plan-day-1",
    exerciseSets: [],
    structureBlocks: [],
    ...overrides,
  } as TimelineEntry;
}

function makeWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: "workout-1",
    mainWorkout: "Logged text",
    accessory: null,
    prescribedMainWorkout: "Prescribed text",
    prescribedAccessory: null,
    exerciseSets: [],
    structureBlocks: [],
    rpe: null,
    notes: null,
    ...overrides,
  };
}

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    workout: makeWorkout(),
    isSaving: false,
    lastSavedAt: null,
    patchSetDebounced: vi.fn(),
    addSet: { mutate: vi.fn() },
    deleteSet: { mutate: vi.fn() },
    updateStructure: { mutate: vi.fn() },
    updateBlockScore: { mutate: vi.fn() },
    updateNote: { mutate: vi.fn() },
    updateRpe: { mutate: vi.fn() },
    updateTimeOfDay: { mutate: vi.fn() },
    updateReference: { mutate: vi.fn() },
    updatePlanDay: { mutate: vi.fn(), isPending: false },
    reparseFreeText: { mutate: vi.fn(), isPending: false },
    reparseFromImage: { mutate: vi.fn(), isPending: false },
    ...overrides,
  };
}

describe("ReviewSurface", () => {
  beforeEach(() => {
    showAdherenceInsights = true;
    mafCeiling = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue([]) }),
    );
    mockUseWorkoutDetail.mockReset();
  });

  it("tones the Avg HR tile against the athlete's MAF ceiling", () => {
    mafCeiling = 145;
    mockUseWorkoutDetail.mockReturnValue(makeDetail());
    render(
      <ReviewSurface
        entry={makeEntry({
          avgHeartrate: 152,
          maxHeartrate: 168,
          exerciseSets: [makeExerciseSet({ exerciseName: "easy_run" })],
        })}
        onClose={vi.fn()}
      />,
    );

    // The overshoot is spelled out in words, not carried by colour alone.
    expect(screen.getByTestId("summary-stat-avg-hr")).toHaveTextContent("Avg HR152 bpm7 over MAF");
  });

  it("leaves RPE out of the stats, since the effort picker shows it", () => {
    mockUseWorkoutDetail.mockReturnValue(makeDetail({ workout: makeWorkout({ rpe: 6 }) }));

    render(<ReviewSurface entry={makeEntry({ duration: 40, rpe: 6 })} onClose={vi.fn()} />);

    expect(screen.getByTestId("summary-stat-duration")).toBeInTheDocument();
    expect(screen.queryByTestId("summary-stat-rpe")).not.toBeInTheDocument();
    expect(screen.getByTestId("rpe-selector")).toBeInTheDocument();
  });

  it("shows results read-first: rows closed, description and structure folded away", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: makeWorkout({
          exerciseSets: [makeExerciseSet({ workoutLogId: "workout-1" })],
        }),
      }),
    );

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    expect(screen.getByTestId("exercise-row-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("workout-contents-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("review-editing-tools")).not.toHaveAttribute("open");
  });

  it("opens the description tools while there are no rows to show", () => {
    mockUseWorkoutDetail.mockReturnValue(makeDetail());

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    // They are how an empty workout gets filled in.
    expect(screen.getByTestId("review-editing-tools")).toHaveAttribute("open");
  });

  it("gathers the supporting context into one session-details card", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({ workout: makeWorkout({ startedAt: null, countsAsTraining: true }) }),
    );

    render(
      <ReviewSurface
        entry={makeEntry({ aiRationale: "Easy aerobic volume." })}
        onClose={vi.fn()}
      />,
    );

    const group = screen.getByTestId("review-session-details-entry-1");
    for (const testId of [
      "review-rationale-entry-1",
      "review-plan-link-workout-1",
      "input-review-time-of-day",
      "switch-review-counts-as-training",
    ]) {
      expect(group).toContainElement(screen.getByTestId(testId));
    }
    // Background on a finished workout: a tap away, not the headline.
    expect(screen.getByTestId("review-rationale-entry-1")).not.toHaveAttribute("open");
    expect(screen.getByTestId("review-plan-link-workout-1")).toHaveTextContent("Not linked");
  });

  it("wires the plan-day picker to the current link and updatePlanDay", async () => {
    const updatePlanDay = { mutate: vi.fn(), isPending: false };
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: makeWorkout({ planId: "plan-1", planDayId: "day-1" }),
        updatePlanDay,
      }),
    );

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    const picker = screen.getByTestId("mock-plan-picker");
    expect(picker.dataset.planId).toBe("plan-1");
    expect(picker.dataset.planDayId).toBe("day-1");

    await userEvent.click(picker);
    expect(updatePlanDay.mutate).toHaveBeenCalledWith({ planId: "plan-9", planDayId: "day-9" });
  });

  it("collapses the Training plan section by default", () => {
    mockUseWorkoutDetail.mockReturnValue(makeDetail());

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    const section = screen.getByTestId("review-plan-link-workout-1");
    expect(section.tagName).toBe("DETAILS");
    expect(section).not.toHaveAttribute("open");
  });

  it("surfaces planned differences when adherence guidance is enabled", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: makeWorkout({
          exerciseSets: [makeExerciseSet({
            workoutLogId: "workout-1",
            weight: 95,
            plannedReps: 8,
            plannedWeight: 100,
          })],
        }),
      }),
    );

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    // Summarised on the closed row, then per set once it's opened.
    expect(screen.getByTestId("exercise-row-planned-diff")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("exercise-row-toggle"));
    expect(screen.getByTestId("planned-weight-set-1")).toHaveTextContent("planned 100 kg");
  }, RENDER_TIMEOUT_MS);

  it("shows the just-completed success callout only when requested", () => {
    mockUseWorkoutDetail.mockReturnValue(makeDetail());

    const { rerender } = render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    expect(screen.queryByTestId("review-completion-success")).not.toBeInTheDocument();

    rerender(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} showCompletionSuccess />);

    expect(screen.getByTestId("review-completion-success")).toHaveTextContent("Workout completed");
  });

  it("saves and parses the visible prescribed reference text", async () => {
    const user = userEvent.setup();
    const updateReference = { mutate: vi.fn() };
    const reparseFreeText = { mutate: vi.fn(), isPending: false };
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        updateReference,
        reparseFreeText,
        workout: makeWorkout({
          accessory: null,
          prescribedMainWorkout: "Original prescription",
          prescribedAccessory: "Accessory text",
          exerciseSets: [],
        }),
      }),
    );

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    const main = screen.getByTestId("prescription-textarea-mainWorkout");
    await user.clear(main);
    await user.type(main, "Updated prescription");
    fireEvent.blur(main);

    expect(updateReference.mutate).toHaveBeenCalledWith({
      prescribedMainWorkout: "Updated prescription",
    });

    await user.click(screen.getByTestId("coach-prescription-parse"));

    expect(reparseFreeText.mutate).toHaveBeenCalledWith({
      prescribedMainWorkout: "Updated prescription",
      prescribedAccessory: "Accessory text",
    });
  });

  it("renames the workout title from the sheet header", async () => {
    const onRenameTitle = vi.fn();
    mockUseWorkoutDetail.mockReturnValue(makeDetail());

    render(
      <ReviewSurface
        entry={makeEntry()}
        onClose={vi.fn()}
        onRenameTitle={onRenameTitle}
      />,
    );

    renameWorkoutTitleFromHeader("workout-title-entry-1", "  Renamed strength  ");

    expectWorkoutTitleRename(onRenameTitle, "entry-1", "Renamed strength");
  });

  it("shows the session-time picker for a manual log and saves edits via updateTimeOfDay", () => {
    const updateTimeOfDay = { mutate: vi.fn() };
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: makeWorkout({ startedAt: null, timeOfDayMin: 6 * 60 }),
        updateTimeOfDay,
      }),
    );

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    const input = screen.getByTestId("input-review-time-of-day");
    expect(input).toHaveValue("06:00");

    fireEvent.change(input, { target: { value: "18:30" } });
    expect(updateTimeOfDay.mutate).toHaveBeenCalledWith(18 * 60 + 30);
  });

  it("hides the session-time picker when the workout has a device start time", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: makeWorkout({ startedAt: new Date("2026-05-06T12:00:00Z"), timeOfDayMin: null }),
      }),
    );

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    expect(screen.queryByTestId("input-review-time-of-day")).not.toBeInTheDocument();
  });

  it("keeps a Strava import fully editable, with the recording's stats alongside", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: makeWorkout({
          mainWorkout: "8.1 km, 45:00",
          prescribedMainWorkout: null,
          startedAt: new Date("2026-05-06T06:30:00Z"),
          // The provenance hint only renders once the log has rows.
          exerciseSets: [makeExerciseSet({ workoutLogId: "workout-1", exerciseName: "easy_run" })],
        }),
      }),
    );

    render(
      <ReviewSurface
        entry={makeEntry({
          source: "strava",
          stravaActivityId: "9001",
          planDayId: null,
          focus: "Workout",
          mainWorkout: "8.1 km, 45:00",
          calories: 610,
          avgSpeed: 3,
        })}
        onClose={vi.fn()}
      />,
    );

    // A generic Strava "Workout" is a stub the athlete fills in: the results
    // editor, RPE and notes all render, labelled as coming from the device.
    expect(screen.getByTestId("review-results-entry-1")).toBeInTheDocument();
    expect(screen.getByText(/from Strava/)).toBeInTheDocument();
    expect(screen.getByTestId("rpe-selector")).toBeInTheDocument();
    expect(screen.getByLabelText("Athlete note")).toBeInTheDocument();
    expect(screen.getByTestId("review-strava-entry-1")).toBeInTheDocument();
    // The device start time wins, so there is no manual session-time picker.
    expect(screen.queryByTestId("input-review-time-of-day")).not.toBeInTheDocument();
  });

  it("offers the recording's heart-rate RPE in the picker without saving it", () => {
    const updateRpe = { mutate: vi.fn() };
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({ workout: makeWorkout({ rpe: null, suggestedRpe: 7 }), updateRpe }),
    );

    render(
      <ReviewSurface
        entry={makeEntry({ source: "strava", stravaActivityId: "9001", avgHeartrate: 150 })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("rpe-selector").dataset.suggestedValue).toBe("7");
    expect(screen.getByTestId("text-rpe-suggestion")).toHaveTextContent(
      "Your heart rate suggests 7",
    );
    // Offered, not applied: the rating is saved only when the athlete taps.
    expect(updateRpe.mutate).not.toHaveBeenCalled();
  });

  it("drops the heart-rate suggestion once the workout carries a rating", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({ workout: makeWorkout({ rpe: 6, suggestedRpe: 7 }) }),
    );

    render(
      <ReviewSurface
        entry={makeEntry({ source: "strava", stravaActivityId: "9001", avgHeartrate: 150 })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("text-rpe-suggestion")).not.toBeInTheDocument();
  });

  it("shows the Strava session stats on a manual log a recording enriched", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: makeWorkout({
          exerciseSets: [makeExerciseSet({ workoutLogId: "workout-1", exerciseName: "back_squat" })],
        }),
      }),
    );

    render(
      <ReviewSurface
        entry={makeEntry({
          source: "manual",
          stravaActivityId: "9002",
          calories: 500,
          avgWatts: 210,
        })}
        onClose={vi.fn()}
      />,
    );

    // Calories are a headline stat; the rest of the recording lines up below.
    expect(screen.getByTestId("summary-stat-calories")).toHaveTextContent("500 kcal");
    expect(screen.getByTestId("review-strava-entry-1")).toHaveTextContent("210 W power");
    expect(screen.getByText(/from coach text/)).toBeInTheDocument();
  });

  it("hides the delete action when no onDelete handler is wired up", () => {
    mockUseWorkoutDetail.mockReturnValue(makeDetail());

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    expect(screen.queryByTestId("review-delete-entry-1")).not.toBeInTheDocument();
  });

  it("asks for confirmation before deleting, and deletes on confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    mockUseWorkoutDetail.mockReturnValue(makeDetail());

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByTestId("review-delete-entry-1"));
    // The click only opens the dialog — it must not delete right away.
    expect(onDelete).not.toHaveBeenCalled();
    expect(await screen.findByTestId("review-confirm-delete-entry-1")).toBeInTheDocument();

    await user.click(screen.getByTestId("review-confirm-delete-entry-1"));

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "entry-1" }));
  });

  it("closes the dialog without deleting when cancelled", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    mockUseWorkoutDetail.mockReturnValue(makeDetail());

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByTestId("review-delete-entry-1"));
    await user.click(await screen.findByTestId("review-cancel-delete-entry-1"));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("review-confirm-delete-entry-1")).not.toBeInTheDocument();
  });

  it("saves the block builder after a pause, the blocks and the rows that follow them together (CL15, U3)", async () => {
    const saveStructure = vi.fn().mockResolvedValue(undefined);
    const updateStructure = { mutate: vi.fn() };
    mockUseWorkoutDetail.mockReturnValue(makeDetail({ saveStructure, updateStructure }));
    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);
    const next: StructureBlockInput[] = [{
      id: "block-emom",
      sectionType: "main",
      formatType: "emom",
      durationMinutes: 8,
      steps: [{ stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "burpees", stepRole: "work" }],
    }];
    const moves: StepLinkMove[] = [
      { blockId: "block-emom", fromStepNumber: 1, toStepNumber: null, fromMinuteIndex: 1, toMinuteIndex: null },
      { blockId: "block-emom", fromStepNumber: 2, toStepNumber: 1, fromMinuteIndex: 2, toMinuteIndex: 1 },
    ];

    let saved: unknown;
    await act(async () => {
      saved = structureEditor.props?.onChange(next, moves);
      await saved;
    });

    expect(structureEditor.props?.saveDebounceMs).toBeGreaterThan(0);
    expect(saveStructure).toHaveBeenCalledWith(next, moves);
    expect(updateStructure.mutate).not.toHaveBeenCalled();
    expect(saved).toBe(saveStructure.mock.results[0]?.value);
  });

  function editingTools(): HTMLDetailsElement {
    const tools = screen.getByTestId("review-editing-tools");
    if (!(tools instanceof HTMLDetailsElement)) throw new Error("expected a <details>");
    return tools;
  }

  it("keeps the description and structure tools open when the first block brings its row (CL14)", () => {
    mockUseWorkoutDetail.mockReturnValue(makeDetail());
    const { rerender } = render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);
    expect(editingTools().open).toBe(true);

    // The athlete adds a block; the server derives an "Unassigned exercise" row from its step.
    const derived = [makeExerciseSet({ id: "derived-1", exerciseName: "custom", customLabel: "Unassigned exercise" })];
    mockUseWorkoutDetail.mockReturnValue(makeDetail({ workout: makeWorkout({ exerciseSets: derived }) }));
    rerender(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    expect(editingTools().open).toBe(true);
  });

  it("opens the tools again when the last row goes, and otherwise leaves them as the athlete set them (CL14)", () => {
    const rows = [makeExerciseSet({ id: "squat-1" })];
    mockUseWorkoutDetail.mockReturnValue(makeDetail({ workout: makeWorkout({ exerciseSets: rows }) }));
    const { rerender } = render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);
    expect(editingTools().open).toBe(false);

    mockUseWorkoutDetail.mockReturnValue(makeDetail());
    rerender(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);
    expect(editingTools().open).toBe(true);

    // The athlete folds them away; a row arriving later keeps them folded.
    act(() => {
      editingTools().open = false;
      fireEvent(editingTools(), new Event("toggle"));
    });
    mockUseWorkoutDetail.mockReturnValue(makeDetail({ workout: makeWorkout({ exerciseSets: rows }) }));
    rerender(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);
    expect(editingTools().open).toBe(false);
  });

  it("says a deleted planned session stays on the plan (CL23)", async () => {
    const user = userEvent.setup();
    mockUseWorkoutDetail.mockReturnValue(makeDetail());
    render(<ReviewSurface entry={makeEntry({ planDayId: "plan-day-1" })} onClose={vi.fn()} onDelete={vi.fn()} />);

    await user.click(screen.getByTestId("review-delete-entry-1"));
    const dialog = await screen.findByRole("alertdialog");

    expect(dialog).toHaveTextContent(
      "The planned session stays on your plan and shows as planned again, or missed if its date has passed.",
    );
    expect(dialog).not.toHaveTextContent(/permanently|cannot be undone/i);
  });

  it("describes deleting a workout logged without a plan (CL23)", async () => {
    const user = userEvent.setup();
    mockUseWorkoutDetail.mockReturnValue(makeDetail());
    render(<ReviewSurface entry={makeEntry({ planDayId: null })} onClose={vi.fn()} onDelete={vi.fn()} />);

    await user.click(screen.getByTestId("review-delete-entry-1"));
    const dialog = await screen.findByRole("alertdialog");

    expect(dialog).toHaveTextContent("This removes the workout and all of its data from your timeline.");
    expect(dialog).not.toHaveTextContent(/plan/i);
  });
});
