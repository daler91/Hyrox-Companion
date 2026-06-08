import type { TimelineEntry } from "@shared/schema";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LogSheet } from "../LogSheet";

const mockUsePlanDayExercises = vi.fn();

vi.mock("@/hooks/usePlanDayExercises", () => ({
  usePlanDayExercises: (planDayId: string | null) => mockUsePlanDayExercises(planDayId),
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "m" }),
}));

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("../FuellingPlanPanel", () => ({
  FuellingPlanPanel: () => null,
}));

const baseEntry = {
  id: "entry-1",
  userId: "user-1",
  date: "2026-05-05",
  focus: "Strength",
  energy: null,
  soreness: null,
  sleepQuality: null,
  completed: false,
  duration: null,
  notes: null,
  coachNote: null,
  coachFeedback: null,
  coachRating: null,
  rpe: null,
  title: null,
  source: "manual",
  planDayId: "plan-day-1",
  mainWorkout: "5x5 squat",
  accessory: null,
  orderIndex: null,
  blockName: null,
  dayName: null,
  phaseName: null,
  weekNumber: null,
  isMissed: false,
  missedLoggedAt: null,
  approvedByCoach: null,
  approvedAt: null,
  createdAt: "2026-05-05T00:00:00.000Z",
  updatedAt: "2026-05-05T00:00:00.000Z",
} as unknown as TimelineEntry;

function makeExerciseSet() {
  return {
    id: "set-1",
    exerciseName: "back_squat",
    category: "strength",
    setNumber: 1,
    reps: 5,
    weight: 100,
    distance: null,
    time: null,
    sortOrder: 0,
  };
}

function makePlanDayExerciseState(overrides = {}) {
  return {
    exerciseSets: [],
    parseFailed: false,
    retryParse: null,
    isSaving: false,
    lastSavedAt: null,
    structureBlocks: [],
    flushPendingSetPatches: vi.fn().mockResolvedValue(undefined),
    patchSetDebounced: vi.fn(),
    addSet: { mutate: vi.fn() },
    deleteSet: { mutate: vi.fn() },
    reparseFreeText: { mutate: vi.fn(), isPending: false },
    reparseFromImage: { mutate: vi.fn(), isPending: false },
    updatePrescription: { mutate: vi.fn() },
    updateStructure: { mutate: vi.fn() },
    ...overrides,
  };
}

function mockPlanDayExerciseState(overrides = {}) {
  mockUsePlanDayExercises.mockReturnValue(makePlanDayExerciseState(overrides));
}

function createDeferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LogSheet parse failures", () => {
  beforeEach(() => {
    mockUsePlanDayExercises.mockReset();
  });

  it("shows a non-blocking helper when reparse fails with no rows", async () => {
    const retryParse = vi.fn();
    const onLogAsPlanned = vi.fn();
    mockPlanDayExerciseState({
      parseFailed: true,
      retryParse,
    });

    render(<LogSheet entry={baseEntry} onClose={vi.fn()} onLogAsPlanned={onLogAsPlanned} />);

    const user = userEvent.setup();

    expect(screen.getByTestId("log-parse-failed-entry-1")).toHaveTextContent(
      "Parse did not create exercise rows. You can still log this workout text-only.",
    );
    expect(screen.getByTestId("log-as-planned-entry-1")).toBeEnabled();

    await user.click(screen.getByTestId("log-parse-retry-entry-1"));
    expect(retryParse).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("log-as-planned-entry-1"));
    await waitFor(() => {
      expect(onLogAsPlanned).toHaveBeenCalledWith(baseEntry, null, null);
    });
  });

  it("carries the athlete note through when completing the workout", async () => {
    const onLogAsPlanned = vi.fn();
    mockPlanDayExerciseState();

    render(<LogSheet entry={baseEntry} onClose={vi.fn()} onLogAsPlanned={onLogAsPlanned} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Notes"), "Felt strong");
    await user.click(screen.getByTestId("log-as-planned-entry-1"));

    await waitFor(() => {
      expect(onLogAsPlanned).toHaveBeenCalledWith(baseEntry, null, "Felt strong");
    });
  });

  it("locks completion while pending edits flush and the log mutation finishes", async () => {
    const flush = createDeferred();
    const log = createDeferred();
    const flushPendingSetPatches = vi.fn(() => flush.promise);
    const onLogAsPlanned = vi.fn(() => log.promise);
    mockPlanDayExerciseState({ flushPendingSetPatches });

    render(<LogSheet entry={baseEntry} onClose={vi.fn()} onLogAsPlanned={onLogAsPlanned} />);

    const user = userEvent.setup();
    const completeButton = screen.getByTestId("log-as-planned-entry-1");

    await user.click(completeButton);

    expect(completeButton).toBeDisabled();
    expect(completeButton).toHaveTextContent("Completing");

    await user.click(completeButton);

    expect(flushPendingSetPatches).toHaveBeenCalledTimes(1);
    expect(onLogAsPlanned).not.toHaveBeenCalled();

    await act(async () => {
      flush.resolve();
      await flush.promise;
    });

    await waitFor(() => expect(onLogAsPlanned).toHaveBeenCalledTimes(1));
    expect(completeButton).toBeDisabled();

    await user.click(completeButton);
    expect(onLogAsPlanned).toHaveBeenCalledTimes(1);

    await act(async () => {
      log.resolve();
      await log.promise;
    });

    await waitFor(() => expect(completeButton).toBeEnabled());
  });

  it("clears warning and enables save after retry succeeds", async () => {
    let parseFailed = true;
    mockUsePlanDayExercises.mockImplementation(() =>
      makePlanDayExerciseState({
        exerciseSets: parseFailed ? [] : [makeExerciseSet()],
        parseFailed,
      }),
    );

    const { rerender } = render(
      <LogSheet entry={baseEntry} onClose={vi.fn()} onLogAsPlanned={vi.fn()} />,
    );
    expect(screen.getByTestId("log-parse-failed-entry-1")).toBeInTheDocument();

    parseFailed = false;
    rerender(<LogSheet entry={baseEntry} onClose={vi.fn()} onLogAsPlanned={vi.fn()} />);
    expect(screen.queryByTestId("log-parse-failed-entry-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("log-as-planned-entry-1")).toBeEnabled();
  });

  it("hides completion controls in edit mode while keeping the prescription editor", () => {
    mockPlanDayExerciseState();

    render(<LogSheet mode="edit" entry={baseEntry} onClose={vi.fn()} />);

    expect(screen.getByTestId("coach-prescription-collapsible")).toBeInTheDocument();
    expect(screen.queryByText(/How hard/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("log-as-planned-entry-1")).not.toBeInTheDocument();
  });

  it("keeps default log mode completion controls", () => {
    mockPlanDayExerciseState();

    render(<LogSheet entry={baseEntry} onClose={vi.fn()} onLogAsPlanned={vi.fn()} />);

    expect(screen.getByText(/How hard/i)).toBeInTheDocument();
    expect(screen.getByTestId("log-as-planned-entry-1")).toHaveTextContent("Complete workout");
  });

  it("renames a planned workout title from the sheet header", async () => {
    const onRenameTitle = vi.fn();
    mockPlanDayExerciseState();

    render(
      <LogSheet
        entry={baseEntry}
        onClose={vi.fn()}
        onLogAsPlanned={vi.fn()}
        onRenameTitle={onRenameTitle}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("workout-title-entry-1-edit"));
    await user.clear(screen.getByTestId("workout-title-entry-1-input"));
    await user.type(screen.getByTestId("workout-title-entry-1-input"), "  Strength updated  ");
    await user.click(screen.getByTestId("workout-title-entry-1-save"));

    expect(onRenameTitle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entry-1" }),
      "Strength updated",
    );
  });
});
