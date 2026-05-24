import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OverviewTrendCharts } from "../OverviewTrendCharts";

vi.mock("../../MiniLineChart", () => ({
  MiniLineChart: ({
    label,
    valueKey,
  }: {
    readonly label: string;
    readonly valueKey: string;
  }) => (
    <section data-testid={`line-chart-${valueKey}`}>
      <h2>{label}</h2>
    </section>
  ),
}));

const rpeData = [
  { weekStart: "2026-05-04", avgRpe: 5 },
  { weekStart: "2026-05-11", avgRpe: 7 },
];

const durationData = [
  { weekStart: "2026-05-04", avgDuration: 45 },
  { weekStart: "2026-05-11", avgDuration: 60 },
];

describe("OverviewTrendCharts", () => {
  it("renders RPE-only trend data in a full-width stack", () => {
    render(<OverviewTrendCharts rpeData={rpeData} durationData={[]} />);

    const trendCharts = screen.getByTestId("overview-trend-charts");
    expect(trendCharts).toHaveClass("space-y-6");
    expect(trendCharts).not.toHaveClass("sm:grid-cols-2");
    expect(screen.getByText("Avg RPE (per week)")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-avgRpe")).toBeInTheDocument();
    expect(screen.queryByText("Avg Duration (min)")).not.toBeInTheDocument();
  });

  it("keeps RPE and duration charts in vertical order", () => {
    render(<OverviewTrendCharts rpeData={rpeData} durationData={durationData} />);

    const rpeHeading = screen.getByText("Avg RPE (per week)");
    const durationHeading = screen.getByText("Avg Duration (min)");

    expect(screen.getByTestId("line-chart-avgRpe")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-avgDuration")).toBeInTheDocument();
    expect(rpeHeading.compareDocumentPosition(durationHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
