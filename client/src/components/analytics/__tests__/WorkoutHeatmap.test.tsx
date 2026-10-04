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
    expect(screen.getAllByTestId("workout-heatmap-day-label").map((label) => label.textContent))
      .toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

    const grid = screen.getByTestId("workout-heatmap-grid");
    expect(grid.getAttribute("style")).toContain("repeat(16, minmax(2rem, 1fr))");
    expect(screen.getAllByTestId("workout-heatmap-week")).toHaveLength(16);
    expect(screen.getAllByTestId("workout-heatmap-cell")).toHaveLength(16 * 7);
  });

  function cellFor(date: string): HTMLElement {
    const cell = screen
      .getAllByTestId("workout-heatmap-cell")
      .find((el) => el.getAttribute("title")?.startsWith(date));
    if (!cell) throw new Error(`no heatmap cell for ${date}`);
    return cell;
  }

  it("draws days before the selected range as outside it, not as rest days (CL6)", () => {
    // "Last 30 days" on 2026-05-24: the range starts 2026-04-25, but the grid
    // reaches back to 2026-02-02.
    render(<WorkoutHeatmap workoutDates={["2026-05-18"]} rangeStart="2026-04-25" />);

    const beforeRange = cellFor("2026-04-24");
    expect(beforeRange).toHaveAttribute("title", "2026-04-24 - Outside selected range");
    expect(beforeRange).toHaveClass("border-dashed");
    expect(beforeRange).not.toHaveClass("bg-muted/60");
    expect(cellFor("2026-02-02")).toHaveAttribute("title", "2026-02-02 - Outside selected range");

    // In-range days keep their rest/workout meaning.
    const firstInRange = cellFor("2026-04-25");
    expect(firstInRange).toHaveAttribute("title", "2026-04-25");
    expect(firstInRange).toHaveClass("bg-muted/60");
    expect(cellFor("2026-05-18")).toHaveClass("bg-primary");

    const outOfRangeCells = screen
      .getAllByTestId("workout-heatmap-cell")
      .filter((el) => el.getAttribute("title")?.endsWith("Outside selected range"));
    // 2026-02-02 .. 2026-04-24 inclusive.
    expect(outOfRangeCells).toHaveLength(82);
    expect(screen.getByTestId("workout-heatmap-out-of-range-legend")).toHaveTextContent(
      "Outside selected range",
    );
  });

  it("treats every past day as in range when no range start is given (All time)", () => {
    render(<WorkoutHeatmap workoutDates={["2026-05-18"]} />);

    expect(cellFor("2026-02-02")).toHaveAttribute("title", "2026-02-02");
    expect(cellFor("2026-02-02")).toHaveClass("bg-muted/60");
    expect(screen.queryByTestId("workout-heatmap-out-of-range-legend")).not.toBeInTheDocument();
  });
});
