import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkoutHeatmap } from "../WorkoutHeatmap";

describe("WorkoutHeatmap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one month-label row and a full 16-week grid", () => {
    render(<WorkoutHeatmap workoutDates={["2026-05-18", "2026-05-20"]} />);

    const monthLabelRow = screen.getByTestId("workout-heatmap-month-label-row");
    expect(monthLabelRow).toHaveClass("gap-x-2");
    expect(screen.getAllByTestId("workout-heatmap-month-label").map((label) => label.textContent))
      .toEqual(["Feb", "Mar", "Apr", "May"]);
    expect(screen.getAllByText("May")).toHaveLength(1);

    const grid = screen.getByTestId("workout-heatmap-grid");
    expect(grid.getAttribute("style")).toContain("repeat(16, minmax(2rem, 1fr))");
    expect(screen.getAllByTestId("workout-heatmap-week")).toHaveLength(16);
    expect(screen.getAllByTestId("workout-heatmap-cell")).toHaveLength(16 * 7);
  });
});
