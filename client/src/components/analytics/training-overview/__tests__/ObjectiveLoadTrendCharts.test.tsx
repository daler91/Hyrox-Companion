import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { overviewWithTrend, trendPoint } from "../loadOverview.testHelpers";
import { ObjectiveLoadTrendCharts } from "../ObjectiveLoadTrendCharts";

vi.mock("../../MiniLineChart", () => ({
  MiniLineChart: ({ label, valueKey }: { readonly label: string; readonly valueKey: string }) => (
    <section data-testid={`line-chart-${valueKey}`}>{label}</section>
  ),
}));

vi.mock("../../MultiLineChart", () => ({
  MultiLineChart: ({
    series,
    testId,
  }: {
    readonly series: ReadonlyArray<{ valueKey: string; label: string }>;
    readonly testId: string;
  }) => (
    <section data-testid={testId}>
      {series.map((s) => (
        <span key={s.valueKey} data-testid={`series-${s.valueKey}`}>
          {s.label}
        </span>
      ))}
    </section>
  ),
}));

describe("ObjectiveLoadTrendCharts", () => {
  it("renders objective comparison, fitness/fatigue and strain when all are seeded", () => {
    const trend = [
      trendPoint({ date: "2026-05-01", trimp: 100, tss: 80, acuteEwma: 60, chronicEwma: 55 }),
      trendPoint({ date: "2026-05-02", trimp: 120, tss: 90, acuteEwma: 70, chronicEwma: 58 }),
    ];
    render(<ObjectiveLoadTrendCharts trainingLoad={overviewWithTrend(trend)} />);

    const objective = screen.getByTestId("multi-line-chart-objective-load");
    expect(within(objective).getByTestId("series-utss")).toBeInTheDocument();
    expect(within(objective).getByTestId("series-trimp")).toBeInTheDocument();
    expect(within(objective).getByTestId("series-tss")).toBeInTheDocument();
    expect(screen.getByTestId("multi-line-chart-fitness-fatigue")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-strain")).toBeInTheDocument();
    expect(screen.queryByTestId("objective-load-hint")).not.toBeInTheDocument();
  });

  it("shows a hint (not the comparison) when there is no HR/power data", () => {
    const trend = [
      trendPoint({ date: "2026-05-01", trimp: null, tss: null, acuteEwma: 60, chronicEwma: 55 }),
      trendPoint({ date: "2026-05-02", trimp: null, tss: null, acuteEwma: 70, chronicEwma: 58 }),
    ];
    render(<ObjectiveLoadTrendCharts trainingLoad={overviewWithTrend(trend)} />);

    expect(screen.getByTestId("objective-load-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("multi-line-chart-objective-load")).not.toBeInTheDocument();
    // The UTSS-derived dynamics still surface.
    expect(screen.getByTestId("multi-line-chart-fitness-fatigue")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-strain")).toBeInTheDocument();
  });

  it("omits the Power TSS series when only HR (TRIMP) data exists", () => {
    const trend = [
      trendPoint({ date: "2026-05-01", trimp: 100, tss: null }),
      trendPoint({ date: "2026-05-02", trimp: 120, tss: null }),
    ];
    render(<ObjectiveLoadTrendCharts trainingLoad={overviewWithTrend(trend)} />);

    const objective = screen.getByTestId("multi-line-chart-objective-load");
    expect(within(objective).getByTestId("series-trimp")).toBeInTheDocument();
    expect(within(objective).queryByTestId("series-tss")).not.toBeInTheDocument();
  });

  it("renders nothing until enough history is seeded", () => {
    const trend = [
      trendPoint({ trimp: null, tss: null, strain: null, acuteEwma: null, chronicEwma: null }),
    ];
    render(<ObjectiveLoadTrendCharts trainingLoad={overviewWithTrend(trend)} />);

    expect(screen.queryByTestId("objective-load-trend-charts")).not.toBeInTheDocument();
  });
});
