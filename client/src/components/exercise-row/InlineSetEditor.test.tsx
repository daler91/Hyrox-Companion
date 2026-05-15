import type { ExerciseSet } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InlineSetEditor } from "./InlineSetEditor";

const baseSet = {
  id: "set-1",
  exerciseName: "wall_balls",
  customLabel: null,
  category: "functional",
  setNumber: 1,
  reps: 10,
  weight: 6,
  distance: null,
  time: null,
  notes: null,
  plannedReps: null,
  plannedWeight: null,
  plannedDistance: null,
  plannedTime: null,
} as ExerciseSet;

describe("InlineSetEditor field commit flow", () => {
  it("keeps rapid typing local and commits only the final value on blur", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[baseSet]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-reps-set-1");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "123" } });

    expect(input).toHaveValue(123);
    expect(onUpdateSet).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onUpdateSet).toHaveBeenCalledTimes(1);
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { reps: 123 });
  });

  it("commits the current draft when pressing Enter", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[baseSet]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-weight-set-1");
    fireEvent.change(input, { target: { value: "7.5" } });

    expect(onUpdateSet).not.toHaveBeenCalled();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onUpdateSet).toHaveBeenCalledTimes(1);
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { weight: 7.5 });
  });

  it("does not visually blank during blur reconciliation when external value is temporarily empty", () => {
    const onUpdateSet = vi.fn();
    const { rerender } = render(
      <InlineSetEditor
        sets={[baseSet]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-reps-set-1");
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.blur(input);

    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { reps: 42 });
    expect(input).toHaveValue(42);

    rerender(
      <InlineSetEditor
        sets={[{ ...baseSet, reps: null }]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-reps-set-1")).toHaveValue(42);

    rerender(
      <InlineSetEditor
        sets={[{ ...baseSet, reps: 42 }]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-reps-set-1")).toHaveValue(42);
  });

  it("displays mile-scale stored feet as miles and patches stored feet on edit", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[{
          ...baseSet,
          exerciseName: "easy_run",
          category: "running",
          reps: null,
          weight: null,
          distance: 15840,
          plannedDistance: 16404,
        }]}
        exerciseName="easy_run"
        customLabel={null}
        category="running"
        weightUnit="lbs"
        distanceUnit="miles"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        showPlannedDiffs
      />,
    );

    expect(screen.getByText("Distance")).toBeInTheDocument();
    expect(screen.queryByText("Distance (ft)")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-distance-set-1")).toHaveValue(3);
    expect(screen.getByTestId("unit-distance-set-1")).toHaveTextContent("mi");
    expect(screen.getByTestId("planned-distance-set-1")).toHaveTextContent("planned 5000 m");

    fireEvent.change(screen.getByTestId("input-distance-set-1"), { target: { value: "3.1" } });
    fireEvent.blur(screen.getByTestId("input-distance-set-1"));

    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { distance: 16368 });
  });

});
