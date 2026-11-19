import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChartExplanation } from "../ChartExplanation";

describe("ChartExplanation a11y", () => {
  it("links the toggle to the panel via aria-controls", () => {
    render(<ChartExplanation explanation="Your weekly volume rose." />);
    const toggle = screen.getByTestId("chart-explanation-toggle");
    const panel = screen.getByTestId("chart-explanation-content");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("role", "region");
    expect(panel).toHaveAttribute("aria-label", "AI explanation");
  });

  it("removes the panel from the DOM when collapsed", async () => {
    const user = userEvent.setup();
    render(<ChartExplanation explanation="Recovery looking good." />);
    const toggle = screen.getByTestId("chart-explanation-toggle");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("chart-explanation-content")).toBeNull();
  });

  it("renders nothing when explanation is undefined", () => {
    const { container } = render(<ChartExplanation />);
    expect(container.innerHTML).toBe("");
  });
});
