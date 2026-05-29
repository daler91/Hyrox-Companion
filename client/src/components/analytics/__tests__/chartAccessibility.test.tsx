import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type ExerciseAnalyticDay, MiniBarChart } from "../MiniBarChart";
import { MiniLineChart } from "../MiniLineChart";

// recharts' ResponsiveContainer can't measure in jsdom; the role="img" wrapper
// these tests assert on sits OUTSIDE it, so it renders regardless. This locks in
// the screen-reader text alternative for charts (WCAG 1.1.1, review WCAG pass).

const barData: ExerciseAnalyticDay[] = [
  { date: "2026-05-01", totalVolume: 100, maxWeight: 50, totalSets: 5, totalReps: 25, totalDistance: 0 },
];
const lineData = [{ date: "2026-05-01", avgRpe: 7 }];

describe("chart accessibility", () => {
  it("MiniBarChart exposes a labelled image role for screen readers", () => {
    render(<MiniBarChart data={barData} valueKey="totalVolume" color="primary" label="Total Volume" />);
    expect(screen.getByRole("img", { name: "Total Volume, bar chart" })).toBeInTheDocument();
  });

  it("MiniLineChart exposes a labelled image role for screen readers", () => {
    render(<MiniLineChart data={lineData} valueKey="avgRpe" color="primary" label="Avg RPE" />);
    expect(screen.getByRole("img", { name: "Avg RPE, line chart" })).toBeInTheDocument();
  });
});
