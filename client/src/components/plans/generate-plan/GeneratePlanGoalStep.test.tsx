import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GeneratePlanGoalStep } from "./GeneratePlanGoalStep";

describe("GeneratePlanGoalStep", () => {
  it("shows a hint and wires it to the Next button when the goal can't proceed", () => {
    render(
      <GeneratePlanGoalStep goal="" onGoalChange={vi.fn()} onNext={vi.fn()} canProceed={false} />,
    );

    const hint = screen.getByText("Describe your training goal to continue.");
    expect(hint).toHaveAttribute("id", "goal-step-hint");
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeDisabled();
    expect(nextButton).toHaveAttribute("aria-describedby", "goal-step-hint");
  });

  it("hides the hint and clears aria-describedby once the goal can proceed", () => {
    render(
      <GeneratePlanGoalStep
        goal="Sub-90 Hyrox open"
        onGoalChange={vi.fn()}
        onNext={vi.fn()}
        canProceed
      />,
    );

    expect(screen.queryByText("Describe your training goal to continue.")).not.toBeInTheDocument();
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeEnabled();
    expect(nextButton).not.toHaveAttribute("aria-describedby");
  });
});
