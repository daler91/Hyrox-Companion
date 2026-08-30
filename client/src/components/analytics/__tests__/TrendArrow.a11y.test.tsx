import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendArrow } from "../ExerciseProgressionCharts";

describe("TrendArrow a11y", () => {
  it.each([
    { trend: "up", name: "Trending up" },
    { trend: "down", name: "Trending down" },
    { trend: "flat", name: "No change" },
  ] as const)("announces '$name' to screen readers for a '$trend' trend", ({ trend, name }) => {
    render(<TrendArrow trend={trend} />);
    const el = screen.getByRole("img", { name });
    expect(el).toBeInTheDocument();
    // The icon itself must be hidden from assistive tech
    expect(el.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
