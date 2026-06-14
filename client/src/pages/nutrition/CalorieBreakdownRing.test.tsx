import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalorieBreakdownRing } from "./CalorieBreakdownRing";
import { macroEnergyShares } from "./utils";

// recharts' ResponsiveContainer can't measure in jsdom; the role="img" wrapper
// sits outside it, so it renders regardless (same convention as the analytics
// chart accessibility tests).
describe("CalorieBreakdownRing", () => {
  it("exposes an image role naming the macro split and shows the calories", () => {
    const shares = macroEnergyShares({ protein: 10, carb: 20, fat: 5 }); // 24 / 48 / 27 %
    render(<CalorieBreakdownRing shares={shares} calories={165} />);

    const ring = screen.getByTestId("calorie-ring");
    expect(ring).toHaveAttribute("role", "img");
    expect(ring).toHaveAttribute(
      "aria-label",
      "Calorie breakdown: protein 24%, carbs 48%, fat 27%",
    );
    expect(screen.getByText("165")).toBeInTheDocument();
  });

  it("renders a zero-energy serving without error", () => {
    const shares = macroEnergyShares({ protein: 0, carb: 0, fat: 0 });
    render(<CalorieBreakdownRing shares={shares} calories={0} />);
    expect(screen.getByTestId("calorie-ring")).toHaveAttribute(
      "aria-label",
      "Calorie breakdown: protein 0%, carbs 0%, fat 0%",
    );
  });
});
