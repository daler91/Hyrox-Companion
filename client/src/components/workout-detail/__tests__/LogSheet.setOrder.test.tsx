import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { LogSheet } from "../LogSheet";

type SaveOrder = (setIds: string[]) => void;

const mocks = vi.hoisted(() => ({
  table: { onSaveOrder: undefined as SaveOrder | undefined },
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "m" }),
}));

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../FuellingPlanPanel", () => ({
  FuellingPlanPanel: () => null,
}));

// Records the order save the sheet hands its table; the drag that calls it is
// covered by exercise-table/__tests__/dnd.test.ts.
vi.mock("../ExerciseTable", () => ({
  ExerciseTable: ({ onSaveOrder }: { onSaveOrder?: SaveOrder }) => {
    mocks.table.onSaveOrder = onSaveOrder;
    return <div data-testid="exercise-table-double" />;
  },
}));

const entry = {
  id: "entry-1",
  date: "2026-05-05",
  focus: "Strength",
  status: "planned",
  planDayId: "plan-day-1",
  mainWorkout: "5x5 squat, 3x10 bench",
  accessory: null,
  notes: null,
  rpe: null,
} as unknown as TimelineEntry;

const SQUAT = makeExerciseSet({
  id: "squat",
  sortOrder: 0,
  planDayId: "plan-day-1",
  workoutLogId: null,
});
const BENCH = makeExerciseSet({
  id: "bench",
  sortOrder: 1,
  planDayId: "plan-day-1",
  workoutLogId: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function renderSheet(onLogAsPlanned: () => Promise<void>) {
  return render(
    <QueryClientProvider client={queryClient}>
      <LogSheet entry={entry} onClose={vi.fn()} onLogAsPlanned={onLogAsPlanned} />
    </QueryClientProvider>,
  );
}

/** Drops an exercise and taps "Complete workout" before the sheet re-renders. */
function dragThenComplete() {
  act(() => {
    mocks.table.onSaveOrder?.(["bench", "squat"]);
    fireEvent.click(screen.getByTestId("log-as-planned-entry-1"));
  });
}

// PF5 (CODEBASE_ANALYSIS_2026-10-03): the one-request order save ran beside
// the plan day's set writes, so "Complete workout" did not wait for it and
// copied the day in its pre-drag order, and went ahead when it failed.
describe("LogSheet completing after a drag", () => {
  beforeEach(() => {
    queryClient.clear();
    mocks.table.onSaveOrder = undefined;
    vi.spyOn(api.plans, "getDayExercises").mockResolvedValue({
      exerciseSets: [SQUAT, BENCH],
      structureBlocks: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds 'Complete workout' while the order save is out", async () => {
    const order = deferred<ExerciseSet[]>();
    vi.spyOn(api.plans, "saveDayExerciseOrder").mockReturnValue(order.promise);
    const onLogAsPlanned = vi.fn(() => Promise.resolve());
    renderSheet(onLogAsPlanned);
    await waitFor(() => expect(mocks.table.onSaveOrder).toBeDefined());

    act(() => {
      mocks.table.onSaveOrder?.(["bench", "squat"]);
    });

    // The save is one of the day's set writes, so the button waits on it.
    await waitFor(() => expect(screen.getByTestId("log-as-planned-entry-1")).toBeDisabled());
    expect(screen.getByTestId("log-as-planned-entry-1")).toHaveTextContent("Saving edits");

    await act(async () => {
      order.resolve([
        { ...BENCH, sortOrder: 0 },
        { ...SQUAT, sortOrder: 1 },
      ]);
      await order.promise;
    });
    await waitFor(() => expect(screen.getByTestId("log-as-planned-entry-1")).not.toBeDisabled());
    expect(onLogAsPlanned).not.toHaveBeenCalled();
  });

  it("logs only once an order save already out has landed", async () => {
    const order = deferred<ExerciseSet[]>();
    const saveOrder = vi.spyOn(api.plans, "saveDayExerciseOrder").mockReturnValue(order.promise);
    const onLogAsPlanned = vi.fn(() => Promise.resolve());
    renderSheet(onLogAsPlanned);
    await waitFor(() => expect(mocks.table.onSaveOrder).toBeDefined());

    dragThenComplete();
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveOrder).toHaveBeenCalledWith("plan-day-1", ["bench", "squat"]);
    expect(onLogAsPlanned).not.toHaveBeenCalled();

    order.resolve([
      { ...BENCH, sortOrder: 0 },
      { ...SQUAT, sortOrder: 1 },
    ]);
    await waitFor(() => expect(onLogAsPlanned).toHaveBeenCalledTimes(1));
  });

  it("stays on the sheet when the order save fails", async () => {
    const order = deferred<ExerciseSet[]>();
    vi.spyOn(api.plans, "saveDayExerciseOrder").mockReturnValue(order.promise);
    const onLogAsPlanned = vi.fn(() => Promise.resolve());
    renderSheet(onLogAsPlanned);
    await waitFor(() => expect(mocks.table.onSaveOrder).toBeDefined());

    dragThenComplete();
    order.reject(new Error("500: Internal Server Error"));

    // The log would copy the stored order the failed save put back.
    await waitFor(() => expect(screen.getByTestId("log-as-planned-entry-1")).not.toBeDisabled());
    expect(onLogAsPlanned).not.toHaveBeenCalled();
  });
});
