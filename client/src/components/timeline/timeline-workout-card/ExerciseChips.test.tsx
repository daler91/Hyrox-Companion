import type { PersonalRecord } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GroupedExercise } from "@/lib/exerciseUtils";

import { ExerciseChips } from "./ExerciseChips";

function group(over: Partial<GroupedExercise> = {}): GroupedExercise {
  return {
    exerciseName: "burpees",
    category: "functional",
    sets: [],
    ...over,
  };
}

describe("ExerciseChips", () => {
  it("renders a chip per exercise group with no confidence or PR decoration by default", () => {
    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group()]}
        workoutLogId="wl-1"
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.getByTestId("badge-exercise-entry-1-0")).toBeInTheDocument();
    expect(screen.queryByTestId("confidence-score-entry-1-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-pr-entry-1-0")).not.toBeInTheDocument();
  });

  it("hides the confidence score once it reaches 90", () => {
    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group({ confidence: 90 })]}
        workoutLogId="wl-1"
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.queryByTestId("confidence-score-entry-1-0")).not.toBeInTheDocument();
  });

  it("shows a low-confidence score in red below 60", () => {
    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group({ confidence: 45 })]}
        workoutLogId="wl-1"
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    const score = screen.getByTestId("confidence-score-entry-1-0");
    expect(score).toHaveTextContent("45%");
    expect(score.className).toContain("text-red-500");
  });

  it("shows a mid-confidence score in yellow between 60 and 79", () => {
    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group({ confidence: 65 })]}
        workoutLogId="wl-1"
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.getByTestId("confidence-score-entry-1-0").className).toContain("text-yellow-500");
  });

  it("shows a high-but-sub-90 confidence score in green", () => {
    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group({ confidence: 85 })]}
        workoutLogId="wl-1"
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.getByTestId("confidence-score-entry-1-0").className).toContain("text-green-500");
  });

  it("flags a custom exercise with the help icon", () => {
    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group({ exerciseName: "custom", customLabel: "Sled drags" })]}
        workoutLogId="wl-1"
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.getByTestId("badge-exercise-entry-1-0").querySelector("svg")).toBeInTheDocument();
  });

  it("badges a group as a PR when this workout set the record", () => {
    const personalRecords: Record<string, PersonalRecord> = {
      burpees: {
        category: "functional",
        maxWeight: { value: 40, date: "2026-06-01", workoutLogId: "wl-1" },
      },
    };

    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group()]}
        workoutLogId="wl-1"
        personalRecords={personalRecords}
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.getByTestId("badge-pr-entry-1-0")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-exercise-entry-1-0")).not.toBeInTheDocument();
  });

  it("does not badge a PR set by a different workout", () => {
    const personalRecords: Record<string, PersonalRecord> = {
      burpees: {
        category: "functional",
        maxWeight: { value: 40, date: "2026-06-01", workoutLogId: "wl-OTHER" },
      },
    };

    render(
      <ExerciseChips
        entryId="entry-1"
        groupedExercises={[group()]}
        workoutLogId="wl-1"
        personalRecords={personalRecords}
        weightLabel="kg"
        distanceUnit="km"
      />,
    );

    expect(screen.queryByTestId("badge-pr-entry-1-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("badge-exercise-entry-1-0")).toBeInTheDocument();
  });
});
