import { getExerciseMissingFields } from "@/lib/exerciseWarnings";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ExerciseInput, StructuredExercise } from "../ExerciseInput";

// Mock missing fields utility to prevent issues
vi.mock("@/lib/exerciseWarnings", () => ({
  getExerciseMissingFields: vi.fn(() => []),
}));

describe("ExerciseInput", () => {
  const defaultOnChange = vi.fn();
  const defaultOnRemove = vi.fn();

  const baseExercise: StructuredExercise = {
    exerciseName: "wall_balls",
    category: "hyrox_station",
    sets: [{ setNumber: 1, reps: 20, weight: 6, time: 60 }],
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Multi-set view (e.g. wall_balls)", () => {
    it("renders the exercise name and default fields", () => {
      render(
        <ExerciseInput
          exercise={baseExercise}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      expect(screen.getByText("Wall Balls")).toBeInTheDocument();
      expect(screen.getByText("1 set")).toBeInTheDocument();

      // Check for multi-set view elements
      expect(screen.getByTestId("button-add-set-wall_balls")).toBeInTheDocument();
      expect(screen.getByTestId("set-row-wall_balls-0")).toBeInTheDocument();

      // Check inputs are rendered with correct initial values
      const repsInput = screen.getByTestId("input-reps-wall_balls-0");
      expect(repsInput).toHaveValue(20);

      const weightInput = screen.getByTestId("input-weight-wall_balls-0");
      expect(weightInput).toHaveValue(6);
    });

    it("adds a new set when 'Add Set' is clicked", () => {
      render(
        <ExerciseInput
          exercise={baseExercise}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const addButton = screen.getByTestId("button-add-set-wall_balls");
      fireEvent.click(addButton);

      expect(defaultOnChange).toHaveBeenCalledTimes(1);
      const updatedExercise = defaultOnChange.mock.calls[0][0];
      expect(updatedExercise.sets).toHaveLength(2);
      expect(updatedExercise.sets[1].setNumber).toBe(2);
      // New set copies values from previous set
      expect(updatedExercise.sets[1].reps).toBe(20);
    });

    it("removes a set when 'Remove set' is clicked", () => {
      const exerciseWithTwoSets: StructuredExercise = {
        ...baseExercise,
        sets: [
          { setNumber: 1, reps: 20, weight: 6 },
          { setNumber: 2, reps: 15, weight: 6 },
        ],
      };

      render(
        <ExerciseInput
          exercise={exerciseWithTwoSets}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const removeButtons = screen.getAllByTestId(/button-remove-set-/);
      expect(removeButtons).toHaveLength(2);

      fireEvent.click(removeButtons[0]);

      expect(defaultOnChange).toHaveBeenCalledTimes(1);
      const updatedExercise = defaultOnChange.mock.calls[0][0];
      expect(updatedExercise.sets).toHaveLength(1);
      expect(updatedExercise.sets[0].reps).toBe(15); // The second set is now the first
      expect(updatedExercise.sets[0].setNumber).toBe(1); // Set numbers should be re-indexed
    });

    it("updates field values when input changes", () => {
      render(
        <ExerciseInput
          exercise={baseExercise}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const repsInput = screen.getByTestId("input-reps-wall_balls-0");
      fireEvent.change(repsInput, { target: { value: "30" } });

      expect(defaultOnChange).toHaveBeenCalledTimes(1);
      const updatedExercise = defaultOnChange.mock.calls[0][0];
      expect(updatedExercise.sets[0].reps).toBe(30);
    });
  });

  describe("Single-set view (e.g. easy_run)", () => {
    const singleSetExercise: StructuredExercise = {
      exerciseName: "easy_run",
      category: "running",
      sets: [{ setNumber: 1, distance: 5, time: 30 }],
    };

    it("renders single set view correctly", () => {
      render(
        <ExerciseInput
          exercise={singleSetExercise}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      // Verify label
      expect(screen.getByText("Easy Run")).toBeInTheDocument();
      expect(screen.getByText("1 set")).toBeInTheDocument();

      // Ensure multi-set view elements do not exist
      expect(screen.queryByTestId("button-add-set-easy_run")).not.toBeInTheDocument();
      expect(screen.queryByTestId("set-row-easy_run-0")).not.toBeInTheDocument();

      // Check fields specific to single-set view are rendered
      const distanceInput = screen.getByTestId("input-distance-easy_run");
      expect(distanceInput).toHaveValue(5);

      const timeInput = screen.getByTestId("input-time-easy_run");
      expect(timeInput).toHaveValue(30);
    });

    it("updates field values when input changes in single set view", () => {
      render(
        <ExerciseInput
          exercise={singleSetExercise}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const distanceInput = screen.getByTestId("input-distance-easy_run");
      fireEvent.change(distanceInput, { target: { value: "10" } });

      expect(defaultOnChange).toHaveBeenCalledTimes(1);
      const updatedExercise = defaultOnChange.mock.calls[0][0];
      expect(updatedExercise.sets[0].distance).toBe(10);
    });
  });

  describe("Additional features and callbacks", () => {
    it("calls onRemove when remove button is clicked", () => {
      render(
        <ExerciseInput
          exercise={baseExercise}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const removeButton = screen.getByTestId("button-remove-wall_balls");
      fireEvent.click(removeButton);

      expect(defaultOnRemove).toHaveBeenCalledTimes(1);
    });

    it("renders confidence badge if confidence is low", () => {
      const exerciseWithConfidence: StructuredExercise = {
        ...baseExercise,
        confidence: 75,
      };

      render(
        <ExerciseInput
          exercise={exerciseWithConfidence}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const badge = screen.getByTestId("badge-confidence-wall_balls");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("AI 75%");
    });

    it("hides confidence badge if confidence is >= 90", () => {
      const exerciseWithHighConfidence: StructuredExercise = {
        ...baseExercise,
        confidence: 95,
      };

      render(
        <ExerciseInput
          exercise={exerciseWithHighConfidence}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const badge = screen.queryByTestId("badge-confidence-wall_balls");
      expect(badge).not.toBeInTheDocument();
    });

    it("displays missing fields warning when returned by getExerciseMissingFields", async () => {
      // Mock getExerciseMissingFields specifically for this test
      const getExerciseMissingFieldsMock = vi
        .mocked(getExerciseMissingFields)
        .mockReturnValueOnce(["Time", "Distance"]);

      render(
        <ExerciseInput
          exercise={baseExercise}
          onChange={defaultOnChange}
          onRemove={defaultOnRemove}
        />,
      );

      const warning = screen.getByTestId("warning-missing-wall_balls");
      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent("Missing time, distance — add for better tracking");

      getExerciseMissingFieldsMock.mockRestore();
    });
  });
});
