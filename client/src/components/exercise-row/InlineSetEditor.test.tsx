import type { ExerciseSet } from "@shared/schema";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineSetEditor } from "./InlineSetEditor";

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

afterEach(() => {
  vi.useRealTimers();
});

describe("InlineSetEditor FieldInput", () => {
  it("keeps the newest typed value when parent updates return out of order", async () => {
    vi.useFakeTimers();

    function Harness() {
      const [sets, setSets] = useState<ExerciseSet[]>([makeSet({ reps: null })]);

      return (
        <InlineSetEditor
          sets={sets}
          exerciseName="back_squat"
          customLabel={null}
          category="strength"
          weightUnit="kg"
          onAddSet={vi.fn()}
          onDeleteSet={vi.fn()}
          onUpdateSet={(setId, data) => {
            const next = data.reps;
            const delay = next === 1 ? 40 : 10;
            setTimeout(() => {
              setSets((prev) =>
                prev.map((s) =>
                  s.id === setId
                    ? {
                        ...s,
                        reps: next ?? null,
                      }
                    : s,
                ),
              );
            }, delay);
          }}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByTestId("input-reps-set-1");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "12" } });

    expect(input).toHaveDisplayValue("12");

    await act(async () => {
      vi.advanceTimersByTime(15);
    });

    expect(input).toHaveDisplayValue("12");

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(input).toHaveDisplayValue("12");
  });

  it("applies a rollback value after blur when it was rejected during active editing", async () => {
    vi.useFakeTimers();

    function Harness() {
      const [sets, setSets] = useState<ExerciseSet[]>([makeSet({ reps: 10 })]);

      return (
        <InlineSetEditor
          sets={sets}
          exerciseName="back_squat"
          customLabel={null}
          category="strength"
          weightUnit="kg"
          onAddSet={vi.fn()}
          onDeleteSet={vi.fn()}
          onUpdateSet={(setId) => {
            setTimeout(() => {
              setSets((prev) =>
                prev.map((s) =>
                  s.id === setId
                    ? {
                        ...s,
                        reps: 7,
                      }
                    : s,
                ),
              );
            }, 20);
          }}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByTestId("input-reps-set-1");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    expect(input).toHaveDisplayValue("12");

    await act(async () => {
      vi.advanceTimersByTime(25);
    });

    // Still editing: stale/external rollback is gated.
    expect(input).toHaveDisplayValue("12");

    fireEvent.blur(input);
    expect(input).toHaveDisplayValue("7");
  });
});
