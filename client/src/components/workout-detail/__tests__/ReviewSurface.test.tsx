import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewSurface } from "../ReviewSurface";

const mockUseWorkoutDetail = vi.fn();
let showAdherenceInsights = true;

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
  ResponsiveSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/RpeSelector", () => ({
  RpeSelector: () => <div data-testid="rpe-selector" />,
}));

vi.mock("@/components/workout-structure", () => ({
  StructureBlocksEditor: () => <div data-testid="structure-blocks-editor" />,
}));

vi.mock("../AthleteNoteInput", () => ({
  AthleteNoteInput: () => <textarea aria-label="Athlete note" />,
}));

const originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
  HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
  HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
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

function makeSet(overrides: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id: "set-1",
    workoutLogId: "workout-1",
    planDayId: null,
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: 8,
    weight: 95,
    distance: null,
    time: null,
    plannedReps: 8,
    plannedWeight: 100,
    plannedDistance: null,
    plannedTime: null,
    blockId: null,
    stepNumber: null,
    intervalMinute: null,
    cycleNumber: null,
    stepRole: null,
    groupId: null,
    intensity: null,
    load: null,
    repMode: null,
    tempo: null,
    standards: null,
    notes: null,
    confidence: 95,
    sortOrder: 0,
    ...overrides,
  };
}

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    workout: {
      id: "workout-1",
      mainWorkout: "Logged text",
      accessory: null,
      prescribedMainWorkout: "Prescribed text",
      prescribedAccessory: null,
      exerciseSets: [],
      structureBlocks: [],
      rpe: null,
      notes: null,
    },
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

  it("surfaces planned differences when adherence guidance is enabled", () => {
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        workout: {
          id: "workout-1",
          mainWorkout: "Logged text",
          prescribedMainWorkout: "Prescribed text",
          exerciseSets: [makeSet()],
          structureBlocks: [],
          rpe: null,
          notes: null,
        },
      }),
    );

    render(<ReviewSurface entry={makeEntry()} onClose={vi.fn()} />);

    expect(screen.getByTestId("planned-weight-set-1")).toHaveTextContent("planned 100 kg");
  });

  it("saves and parses the visible prescribed reference text", async () => {
    const user = userEvent.setup();
    const updateReference = { mutate: vi.fn() };
    const reparseFreeText = { mutate: vi.fn(), isPending: false };
    mockUseWorkoutDetail.mockReturnValue(
      makeDetail({
        updateReference,
        reparseFreeText,
        workout: {
          id: "workout-1",
          mainWorkout: "Logged text",
          accessory: null,
          prescribedMainWorkout: "Original prescription",
          prescribedAccessory: "Accessory text",
          exerciseSets: [],
          structureBlocks: [],
          rpe: null,
          notes: null,
        },
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
});
