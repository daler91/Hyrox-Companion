import "@testing-library/jest-dom/vitest";

import type { TrainingLoadOverview, TrainingLoadTrendPoint } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormMonotonyTrendCharts } from "../FormMonotonyTrendCharts";

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

function trendPoint(overrides: Partial<TrainingLoadTrendPoint>): TrainingLoadTrendPoint {
  return {
    date: "2026-05-01",
    utss: 50,
    acwr: 1,
    zone: "sweet_spot",
    tsb: 0,
    monotony: 1.2,
    strain: 300,
    trimp: null,
    ...overrides,
  };
}

function overview(trend: TrainingLoadTrendPoint[]): TrainingLoadOverview {
  return {
    currentUtss: 0,
    acuteAvg: 0,
    chronicAvg: 0,
    acwr: null,
    zone: "insufficient_data",
    tsb: null,
    monotony: null,
    strain: null,
    monotonyZone: "ok",
    trimp: null,
    tss: null,
    flaggedVectors: [],
    activeRestrictions: [],
    downshiftRationale: null,
    trend,
  };
}

describe("FormMonotonyTrendCharts", () => {
  it("renders Form (TSB) and Monotony charts when enough history is seeded", () => {
    const trend = [
      trendPoint({ date: "2026-05-01", tsb: -5, monotony: 1.1 }),
      trendPoint({ date: "2026-05-02", tsb: 8, monotony: 2.3 }),
    ];
    render(<FormMonotonyTrendCharts trainingLoad={overview(trend)} />);

    expect(screen.getByTestId("load-dynamics-trend-charts")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-tsb")).toBeInTheDocument();
    expect(screen.getByText("Form (TSB)")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-monotony")).toBeInTheDocument();
    expect(screen.getByText("Monotony")).toBeInTheDocument();
  });

  it("omits a chart whose metric has fewer than two seeded points", () => {
    // tsb has 1 non-null point → omitted; monotony has 2 → rendered.
    const trend = [
      trendPoint({ date: "2026-05-01", tsb: null, monotony: 1.1 }),
      trendPoint({ date: "2026-05-02", tsb: 8, monotony: 2.3 }),
    ];
    render(<FormMonotonyTrendCharts trainingLoad={overview(trend)} />);

    expect(screen.queryByTestId("line-chart-tsb")).not.toBeInTheDocument();
    expect(screen.getByTestId("line-chart-monotony")).toBeInTheDocument();
  });

  it("renders nothing when no trend points are seeded", () => {
    const trend = [trendPoint({ tsb: null, monotony: null })];
    render(<FormMonotonyTrendCharts trainingLoad={overview(trend)} />);

    expect(screen.queryByTestId("load-dynamics-trend-charts")).not.toBeInTheDocument();
  });
});
