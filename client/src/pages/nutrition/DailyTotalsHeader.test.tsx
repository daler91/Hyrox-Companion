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
});
