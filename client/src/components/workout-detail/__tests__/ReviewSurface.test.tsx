import type { TimelineEntry } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { ReviewSurface } from "../ReviewSurface";
import {
  expectWorkoutTitleRename,
  renameWorkoutTitleFromHeader,
} from "./workoutTitleTestHelpers";

const mockUseWorkoutDetail = vi.fn();
let showAdherenceInsights = true;
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

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/components/RpeSelector", () => ({
  RpeSelector: () => <div data-testid="rpe-selector" />,
}));

vi.mock("@/components/workout-structure", () => ({
  StructureBlocksEditor: () => <div data-testid="structure-blocks-editor" />,
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue([]) }),
    );
    mockUseWorkoutDetail.mockReset();
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
});
