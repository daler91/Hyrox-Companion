import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkoutHeatmap } from "../WorkoutHeatmap";

describe("WorkoutHeatmap", () => {
  it("has an accessible role and label summarising workout count", () => {
    render(<WorkoutHeatmap workoutDates={["2025-01-01", "2025-01-03"]} />);
    const heatmap = screen.getByRole("img");
    expect(heatmap).toHaveAccessibleName(/2 workouts/i);
  });

  it("uses singular 'workout' when only one date is provided", () => {
    render(<WorkoutHeatmap workoutDates={["2025-01-01"]} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/1 workout in/i);
  });

  it("handles empty workout dates", () => {
    render(<WorkoutHeatmap workoutDates={[]} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/0 workouts/i);
  });
});
