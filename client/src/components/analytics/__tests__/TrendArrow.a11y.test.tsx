import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendArrow } from "../ExerciseProgressionCharts";

describe("TrendArrow a11y", () => {
  it("announces 'Trending up' to screen readers for an upward trend", () => {
    render(<TrendArrow trend="up" />);
    const el = screen.getByRole("img", { name: "Trending up" });
    expect(el).toBeInTheDocument();
    // The icon itself must be hidden from assistive tech
    expect(el.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("announces 'Trending down' to screen readers for a downward trend", () => {
    render(<TrendArrow trend="down" />);
    const el = screen.getByRole("img", { name: "Trending down" });
    expect(el).toBeInTheDocument();
    expect(el.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("announces 'No change' to screen readers for a flat trend", () => {
    render(<TrendArrow trend="flat" />);
    const el = screen.getByRole("img", { name: "No change" });
    expect(el).toBeInTheDocument();
    expect(el.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
