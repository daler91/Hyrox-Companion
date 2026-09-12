import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OverviewTrendCharts } from "../OverviewTrendCharts";

// The real hook reads preferences through react-query, which would need a
// provider here; the unit is what matters to these assertions, not how it is
// fetched.
const preferences = { distanceUnit: "km", distanceLabel: "km" };
vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => preferences,
}));

vi.mock("../../MiniLineChart", () => ({
  MiniLineChart: ({
    label,
    valueKey,
    data,
    valueFormatter,
  }: {
    readonly label: string;
    readonly valueKey: string;
    readonly data: ReadonlyArray<Record<string, number | string | null>>;
    readonly valueFormatter?: (value: number) => string;
  }) => (
    <section data-testid={`line-chart-${valueKey}`}>
      <h2>{label}</h2>
      <ul>
        {data.map((point) => {
          const value = Number(point[valueKey]);
          return (
            <li key={String(point.weekStart)}>
              {valueFormatter ? valueFormatter(value) : String(value)}
            </li>
          );
        })}
      </ul>
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

const mileageData = [
  { weekStart: "2026-05-04", runningMeters: 10_000 },
  { weekStart: "2026-05-11", runningMeters: 12_400 },
];

describe("OverviewTrendCharts", () => {
  it("renders RPE-only trend data in a full-width stack", () => {
    render(<OverviewTrendCharts rpeData={rpeData} durationData={[]}
          mileageData={[]} />);

    const trendCharts = screen.getByTestId("overview-trend-charts");
    expect(trendCharts).toHaveClass("space-y-6");
    expect(trendCharts).not.toHaveClass("sm:grid-cols-2");
    expect(screen.getByText("Avg RPE (per week)")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-avgRpe")).toBeInTheDocument();
    expect(screen.queryByText("Avg Duration (min)")).not.toBeInTheDocument();
  });

  it("keeps RPE and duration charts in vertical order", () => {
    render(<OverviewTrendCharts rpeData={rpeData} durationData={durationData}
          mileageData={[]} />);

    const rpeHeading = screen.getByText("Avg RPE (per week)");
    const durationHeading = screen.getByText("Avg Duration (min)");

    expect(screen.getByTestId("line-chart-avgRpe")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-avgDuration")).toBeInTheDocument();
    expect(rpeHeading.compareDocumentPosition(durationHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("draws weekly mileage in the athlete's own distance unit", () => {
    // The series arrives in canonical metres; converting at the render edge is
    // what keeps this chart and the "Running" stat card from disagreeing.
    render(<OverviewTrendCharts rpeData={[]} durationData={[]} mileageData={mileageData} />);

    expect(screen.getByTestId("line-chart-runningMeters")).toBeInTheDocument();
    expect(screen.getByText("Running (km per week)")).toBeInTheDocument();
    expect(screen.getByText("10 km")).toBeInTheDocument();
    expect(screen.getByText("12.4 km")).toBeInTheDocument();
  });

  it("omits the mileage chart for an athlete with a single week of running", () => {
    // One point is not a trend — the same bar the RPE and duration series clear.
    render(
      <OverviewTrendCharts rpeData={[]} durationData={[]} mileageData={[mileageData[0]]} />,
    );

    expect(screen.queryByTestId("line-chart-runningMeters")).not.toBeInTheDocument();
  });
});
