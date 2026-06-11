import type { BlockViewPoint } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FuellingCorrelationCard } from "../FuellingCorrelationCard";

function point(over: Partial<BlockViewPoint>): BlockViewPoint {
  return {
    date: "2026-06-01",
    calories: 2000,
    protein: 150,
    carb: 300,
    fat: 60,
    fiber: 20,
    utss: 50,
    carbTargetG: 300,
    avgRpe: null,
    compliancePct: null,
    ...over,
  };
}

// 3 carb-hit + 3 carb-miss training days vs a 300g target.
const POINTS: BlockViewPoint[] = [
  point({ date: "2026-06-01", carb: 300, avgRpe: 6, compliancePct: 90 }),
  point({ date: "2026-06-02", carb: 290, avgRpe: 6.5, compliancePct: 88 }),
  point({ date: "2026-06-03", carb: 270, avgRpe: 6.4, compliancePct: 86 }),
  point({ date: "2026-06-04", carb: 150, avgRpe: 7.5, compliancePct: 78 }),
  point({ date: "2026-06-05", carb: 180, avgRpe: 7.2, compliancePct: 74 }),
  point({ date: "2026-06-06", carb: 200, avgRpe: 7.3, compliancePct: 82 }),
];

describe("FuellingCorrelationCard", () => {
  it("compares RPE and compliance across carb-hit vs carb-miss days", () => {
    render(<FuellingCorrelationCard points={POINTS} />);

    expect(screen.getByTestId("fuelling-correlation-rpe")).toHaveTextContent(
      "6.3 on carb-hit days (3) vs 7.3 missed (3)",
    );
    expect(screen.getByTestId("fuelling-correlation-rpe")).toHaveTextContent("felt easier");
    expect(screen.getByTestId("fuelling-correlation-compliance")).toHaveTextContent(
      "88% on carb-hit days (3) vs 78% missed (3)",
    );
    expect(screen.getByTestId("fuelling-correlation-compliance")).toHaveTextContent(
      "10 pts better",
    );
  });

  it("shows the keep-logging note under the min-N guard", () => {
    render(<FuellingCorrelationCard points={POINTS.slice(0, 4)} />);

    expect(screen.getByTestId("fuelling-correlation-insufficient")).toBeInTheDocument();
  });

  it("renders nothing when no day has both a carb target and an outcome", () => {
    render(
      <FuellingCorrelationCard
        points={[point({ carbTargetG: null, avgRpe: 6 }), point({ avgRpe: null })]}
      />,
    );

    expect(screen.queryByTestId("fuelling-correlation-card")).not.toBeInTheDocument();
  });
});
