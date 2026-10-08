import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MultiLineChart, MultiLineTooltip } from "./MultiLineChart";

const data = [
  { date: "2026-05-01", a: 1, b: 2 },
  { date: "2026-05-02", a: 3, b: 4 },
];
const series = [
  { valueKey: "a", color: "green", label: "A" },
  { valueKey: "b", color: "amber", label: "B" },
];

describe("MultiLineChart", () => {
  it("renders a labelled image-role chart with its title", () => {
    render(<MultiLineChart data={data} series={series} label="Load overlay" testId="multi-line-chart-test" />);

    expect(screen.getByTestId("multi-line-chart-test")).toBeInTheDocument();
    expect(screen.getByText("Load overlay")).toBeInTheDocument();
    // role="img" wrapper sits outside ResponsiveContainer, so it renders in jsdom.
    expect(screen.getByRole("img", { name: "Load overlay, line chart" })).toBeInTheDocument();
  });

  it("renders nothing when there is no data", () => {
    const { container } = render(
      <MultiLineChart data={[]} series={series} label="Load overlay" testId="multi-line-chart-test" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no series", () => {
    const { container } = render(
      <MultiLineChart data={data} series={[]} label="Load overlay" testId="multi-line-chart-test" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MultiLineTooltip", () => {
  it("labels a weekStart-keyed point with its week and year (U7)", () => {
    render(
      <MultiLineTooltip
        active
        xKey="weekStart"
        payload={[{ value: 6.5, name: "Avg RPE", payload: { weekStart: "2025-03-03", avgRpe: 6.5 } }]}
      />,
    );
    expect(screen.getByText("Week of Mar 3, 2025")).toBeInTheDocument();
    expect(screen.getByText("6.5")).toBeInTheDocument();
  });

  it("labels a date-keyed point with its full date", () => {
    render(
      <MultiLineTooltip active payload={[{ value: 3, name: "A", payload: { date: "2026-05-01", a: 3 } }]} />,
    );
    expect(screen.getByText("May 1, 2026")).toBeInTheDocument();
  });
});
