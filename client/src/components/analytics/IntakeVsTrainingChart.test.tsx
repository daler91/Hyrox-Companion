import type { BlockViewPoint } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntakeVsTrainingChart } from "./IntakeVsTrainingChart";

// recharts' ResponsiveContainer can't measure in jsdom; the role="img" wrapper
// asserted on here sits OUTSIDE it, so it renders regardless (matches the
// existing chartAccessibility test approach).

function point(date: string, calories: number, utss: number): BlockViewPoint {
  return { date, calories, protein: calories / 10, carb: calories / 5, fat: calories / 20, fiber: 2, utss };
}

describe("IntakeVsTrainingChart", () => {
  it("renders the dual-axis chart when there are multiple days", () => {
    const points = [
      point("2026-06-01", 2000, 50),
      point("2026-06-02", 1800, 40),
      point("2026-06-03", 0, 0),
    ];
    render(<IntakeVsTrainingChart points={points} />);

    expect(
      screen.getByRole("img", { name: /daily calorie intake against training UTSS/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("intake-vs-training-empty")).not.toBeInTheDocument();
  });

  it("renders a dashed empty state for a too-sparse range", () => {
    render(<IntakeVsTrainingChart points={[point("2026-06-01", 0, 0)]} />);

    expect(screen.getByTestId("intake-vs-training-empty")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
