import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExerciseSelector } from "../ExerciseSelector";

const INTERACTION_TIMEOUT_MS = 10_000;

function setup() {
  const onToggle = vi.fn();
  render(<ExerciseSelector selectedExercises={[]} onToggle={onToggle} />);

  return {
    onToggle,
    search: screen.getByLabelText("Search exercises"),
    user: userEvent.setup(),
  };
}

describe("ExerciseSelector", () => {
  it("filters exercises by displayed label and keeps the EMOM helper visible", async () => {
    const { search, user } = setup();

    await user.type(search, "sled push");

    expect(screen.getByTestId("exercise-selector-emom-help")).toHaveTextContent("EMOM is configured");
    expect(screen.getByTestId("button-exercise-sled_push")).toHaveTextContent("Sled Push");
    expect(screen.queryByTestId("button-exercise-back_squat")).not.toBeInTheDocument();
    expect(screen.queryByText("Strength")).not.toBeInTheDocument();
  }, INTERACTION_TIMEOUT_MS);

  it("filters exercises by canonical key", async () => {
    const { search, user } = setup();

    await user.type(search, "back_squat");

    expect(screen.getByTestId("button-exercise-back_squat")).toHaveTextContent("Back Squat");
    expect(screen.queryByTestId("button-exercise-sled_push")).not.toBeInTheDocument();
  });

  it("filters exercises by aliases and shorthand", async () => {
    const { search, user } = setup();

    await user.type(search, "db bench");
    expect(screen.getByTestId("button-exercise-dumbbell_bench_press")).toHaveTextContent("Dumbbell Bench Press");
    expect(screen.queryByTestId("button-exercise-back_squat")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "t2b");
    expect(screen.getByTestId("button-exercise-toes_to_bar")).toHaveTextContent("Toes to Bar");

    await user.clear(search);
    await user.type(search, "bikeerg");
    expect(screen.getByTestId("button-exercise-bike_erg")).toHaveTextContent("BikeErg");
  });

  it("shows an empty state for misses and keeps filtered selection working", async () => {
    const { onToggle, search, user } = setup();

    await user.type(search, "not a movement");

    expect(screen.getByTestId("exercise-selector-empty")).toHaveTextContent("No matching exercises");
    expect(screen.queryByTestId("button-exercise-back_squat")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "bikeerg");
    await user.click(screen.getByTestId("button-exercise-bike_erg"));

    expect(onToggle).toHaveBeenCalledWith("bike_erg");
  });
});
