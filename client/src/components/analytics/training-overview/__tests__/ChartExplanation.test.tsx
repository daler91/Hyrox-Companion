import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChartExplanation } from "../ChartExplanation";

describe("ChartExplanation", () => {
  it("renders nothing without an explanation", () => {
    const { container } = render(<ChartExplanation />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the explanation as Markdown once the lazy chunk resolves", async () => {
    render(<ChartExplanation explanation="Your load is **rising** steadily." />);

    // The text is readable straight away (plain-text fallback), then upgrades.
    expect(screen.getByTestId("chart-explanation-content")).toHaveTextContent(/rising/);
    const strong = await screen.findByText("rising", { selector: "strong" });
    expect(strong).toBeInTheDocument();
  });

  it("collapses and re-expands via the toggle", async () => {
    const user = userEvent.setup();
    render(<ChartExplanation explanation="Steady week." />);

    const toggle = screen.getByTestId("chart-explanation-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(screen.queryByTestId("chart-explanation-content")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(await screen.findByText("Steady week.")).toBeInTheDocument();
  });
});
