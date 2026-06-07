import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DailyTotalsHeader } from "./DailyTotalsHeader";

describe("DailyTotalsHeader", () => {
  it("renders calories and each macro total", () => {
    render(
      <DailyTotalsHeader totals={{ calories: 1234, protein: 80, carb: 150, fat: 40, fiber: 25 }} />,
    );
    expect(screen.getByTestId("total-calories")).toHaveTextContent("1234");
    expect(screen.getByTestId("total-protein")).toHaveTextContent("80");
    expect(screen.getByTestId("total-carb")).toHaveTextContent("150");
    expect(screen.getByTestId("total-fat")).toHaveTextContent("40");
    expect(screen.getByTestId("total-fiber")).toHaveTextContent("25");
  });

  it("shows progress only for macros with a set target", () => {
    render(
      <DailyTotalsHeader
        totals={{ calories: 1000, protein: 80, carb: 150, fat: 40, fiber: 25 }}
        effectiveTarget={{ calories: 2000, proteinG: 160, carbG: null, fatG: null, carbDeltaG: 0, utss: 0, scaled: false }}
      />,
    );
    expect(screen.getByTestId("target-progress-calories")).toHaveTextContent("1000 / 2000");
    expect(screen.getByTestId("target-progress-protein")).toBeInTheDocument();
    // No carb/fat/fiber goals set → no progress for those.
    expect(screen.queryByTestId("target-progress-carb")).not.toBeInTheDocument();
    expect(screen.queryByTestId("target-progress-fiber")).not.toBeInTheDocument();
    expect(screen.queryByTestId("carb-load-note")).not.toBeInTheDocument();
  });

  it("shows the carb-load note when the target is load-scaled", () => {
    render(
      <DailyTotalsHeader
        totals={{ calories: 1000, protein: 80, carb: 150, fat: 40, fiber: 25 }}
        effectiveTarget={{ calories: 2240, proteinG: 150, carbG: 260, fatG: 60, carbDeltaG: 60, utss: 80, scaled: true }}
      />,
    );
    expect(screen.getByTestId("carb-load-note")).toHaveTextContent("+60g for today's load");
    expect(screen.getByTestId("target-progress-carb")).toHaveTextContent("150 / 260");
  });
});
