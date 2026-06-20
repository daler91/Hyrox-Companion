import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormMonotonyTrendCharts } from "../FormMonotonyTrendCharts";
import { overviewWithTrend, trendPoint } from "../loadOverview.testHelpers";

vi.mock("../../MiniLineChart", () => ({
  MiniLineChart: ({ label, valueKey }: { readonly label: string; readonly valueKey: string }) => (
    <section data-testid={`line-chart-${valueKey}`}>{label}</section>
  ),
}));

describe("FormMonotonyTrendCharts", () => {
  it("renders Form (TSB) and Monotony charts when enough history is seeded", () => {
    const trend = [
      trendPoint({ date: "2026-05-01", tsb: -5, monotony: 1.1 }),
      trendPoint({ date: "2026-05-02", tsb: 8, monotony: 2.3 }),
    ];
    render(<FormMonotonyTrendCharts trainingLoad={overviewWithTrend(trend)} />);

    expect(screen.getByTestId("load-dynamics-trend-charts")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-tsb")).toBeInTheDocument();
    expect(screen.getByText("Form (TSB)")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-monotony")).toBeInTheDocument();
    expect(screen.getByText("Monotony")).toBeInTheDocument();
  });

  it("omits a chart whose metric has fewer than two seeded points", () => {
    const trend = [
      trendPoint({ date: "2026-05-01", tsb: null, monotony: 1.1 }),
      trendPoint({ date: "2026-05-02", tsb: 8, monotony: 2.3 }),
    ];
    render(<FormMonotonyTrendCharts trainingLoad={overviewWithTrend(trend)} />);

    expect(screen.queryByTestId("line-chart-tsb")).not.toBeInTheDocument();
    expect(screen.getByTestId("line-chart-monotony")).toBeInTheDocument();
  });

  it("renders nothing when no trend points are seeded", () => {
    const trend = [trendPoint({ tsb: null, monotony: null })];
    render(<FormMonotonyTrendCharts trainingLoad={overviewWithTrend(trend)} />);

    expect(screen.queryByTestId("load-dynamics-trend-charts")).not.toBeInTheDocument();
  });
});
