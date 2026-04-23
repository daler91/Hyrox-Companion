import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { Activity } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "../MetricCard";

describe("MetricCard a11y", () => {
  const baseProps = {
    title: "Total Workouts",
    value: "12",
    icon: Activity,
  };

  it("has no WCAG violations with minimal props", async () => {
    const { container } = render(<MetricCard {...baseProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no WCAG violations with a trending-up indicator", async () => {
    const { container } = render(
      <MetricCard {...baseProps} unit="km" trend="up" trendValue="+15%" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no WCAG violations with a trending-down indicator", async () => {
    const { container } = render(
      <MetricCard {...baseProps} unit="reps" trend="down" trendValue="-8%" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
