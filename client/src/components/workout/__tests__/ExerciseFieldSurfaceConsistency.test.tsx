import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { ExerciseInput } from "@/components/ExerciseInput";
import { ExerciseRow } from "@/components/workout/ExerciseRow";

const noop = vi.fn();

describe("exercise field metadata consistency across surfaces", () => {
  const baseExercise: StructuredExercise = {
    exerciseName: "easy_run",
    category: "running",
    sets: [{ setNumber: 1, distance: 1600, time: 10 }],
  };

  it("uses the same visible fields for single-set exercises", () => {
    render(<ExerciseInput exercise={baseExercise} onChange={noop} onRemove={noop} />);
    expect(screen.getByTestId("input-distance-easy_run")).toBeInTheDocument();
    expect(screen.getByTestId("input-time-easy_run")).toBeInTheDocument();
    expect(screen.queryByTestId("input-reps-easy_run")).not.toBeInTheDocument();

    render(
      <ExerciseRow
        exerciseName="easy_run"
        displayLabel="Easy Run"
        blocks={[{ blockId: "b1", data: baseExercise }]}
        isExpanded={true}
        onToggle={noop}
        onAdd={noop}
        onDuplicate={noop}
        onUpdateBlock={noop}
        onRemoveBlock={noop}
        weightUnit="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.getByTestId("input-distance-b1-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-time-b1-0")).toBeInTheDocument();
    expect(screen.queryByTestId("input-reps-b1-0")).not.toBeInTheDocument();
  });

  it("uses the same editable fields for multi-set exercises", () => {
    const wallBalls: StructuredExercise = {
      exerciseName: "wall_balls",
      category: "functional",
      sets: [{ setNumber: 1, reps: 20, weight: 6 }],
    };

    render(<ExerciseInput exercise={wallBalls} onChange={noop} onRemove={noop} />);
    expect(screen.getByTestId("input-reps-wall_balls-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-weight-wall_balls-0")).toBeInTheDocument();

    render(
      <ExerciseRow
        exerciseName="wall_balls"
        displayLabel="Wall Balls"
        blocks={[{ blockId: "b2", data: wallBalls }]}
        isExpanded={true}
        onToggle={noop}
        onAdd={noop}
        onDuplicate={noop}
        onUpdateBlock={noop}
        onRemoveBlock={noop}
        weightUnit="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.getByTestId("input-reps-b2-0")).toBeInTheDocument();
    expect(screen.getByTestId("input-weight-b2-0")).toBeInTheDocument();
  });
});
