import type { ExerciseSet } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InlineSetEditor } from "./InlineSetEditor";

const baseSet: ExerciseSet = {
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
};

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
});
