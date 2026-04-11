import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeltaIndicator } from "../DeltaIndicator";

describe("DeltaIndicator", () => {
  it("renders nothing when both current and previous are zero", () => {
    const { container } = render(<DeltaIndicator current={0} previous={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a muted 'new' label when previous is zero and current is positive", () => {
    render(<DeltaIndicator current={5} previous={0} testIdSuffix="test" />);
    expect(screen.getByTestId("delta-new-test")).toHaveTextContent(/new/i);
  });

  it("renders an up arrow with positive percentage when current improves on previous (higher is better)", () => {
    render(<DeltaIndicator current={12} previous={10} testIdSuffix="test" />);
    const el = screen.getByTestId("delta-up-test");
    expect(el).toHaveTextContent("20%");
    // aria-label should describe the improvement
    expect(el).toHaveAttribute("aria-label", expect.stringContaining("Improved"));
  });

  it("renders a down arrow styled as a regression when current drops (higher is better)", () => {
    render(<DeltaIndicator current={8} previous={10} testIdSuffix="test" />);
    const el = screen.getByTestId("delta-down-test");
    expect(el).toHaveTextContent("20%");
    expect(el).toHaveAttribute("aria-label", expect.stringContaining("Regressed"));
  });

  it("flips improvement semantics when lowerIsBetter is set", () => {
    // Dropping average RPE from 8 to 6 is a POSITIVE recovery signal.
    render(<DeltaIndicator current={6} previous={8} lowerIsBetter testIdSuffix="test" />);
    const el = screen.getByTestId("delta-up-test");
    expect(el).toHaveTextContent("25%");
    expect(el).toHaveAttribute("aria-label", expect.stringContaining("Improved"));
  });

  it("renders a flat indicator when change is below the 0.5% noise threshold", () => {
    // 100.3 vs 100 is a 0.3% change — should be flat.
    render(<DeltaIndicator current={100.3} previous={100} testIdSuffix="test" />);
    expect(screen.getByTestId("delta-flat-test")).toBeInTheDocument();
  });

  it("treats 0.45%–0.49% as flat even though they round up to 0.5%", () => {
    // Regression test: previously the flat check ran on the one-decimal
    // rounded value, so raw 0.47% became 0.5% and fell through to the
    // up-arrow branch. The cutoff should apply to the unrounded percentage.
    render(<DeltaIndicator current={100.47} previous={100} testIdSuffix="test" />);
    expect(screen.getByTestId("delta-flat-test")).toBeInTheDocument();
  });

  it("includes unit in the tooltip (title attribute) when supplied", () => {
    render(<DeltaIndicator current={55} previous={50} unit="min" testIdSuffix="test" />);
    const el = screen.getByTestId("delta-up-test");
    expect(el.getAttribute("title")).toContain("50min");
    expect(el.getAttribute("title")).toContain("55min");
  });

  it("rounds percentages to one decimal place", () => {
    // 73 vs 70 is exactly 4.2857...%
    render(<DeltaIndicator current={73} previous={70} testIdSuffix="test" />);
    expect(screen.getByTestId("delta-up-test")).toHaveTextContent("4.3%");
  });
});
