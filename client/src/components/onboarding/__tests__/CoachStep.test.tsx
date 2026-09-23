import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { CoachStep } from "../CoachStep";

describe("CoachStep", () => {
  it("starts from the saved answer, off for a new account", async () => {
    const { container } = render(<CoachStep aiCoachEnabled={false} onAiCoachEnabledChange={vi.fn()} />);

    expect(screen.getByRole("radiogroup", { name: "AI Coach" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Not now/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Turn on the AI Coach/ })).not.toBeChecked();
    // Nothing is sent while it stays off, so there is nothing to disclose yet.
    expect(screen.queryByText(/Your recent workout history/)).not.toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows what the AI Coach sends once it is chosen, before Continue records it", async () => {
    const { container } = render(<CoachStep aiCoachEnabled onAiCoachEnabledChange={vi.fn()} />);

    expect(screen.getByText(/Your recent workout history/)).toBeInTheDocument();
    expect(screen.getByText(/By enabling, you consent to this data processing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Privacy Policy/ })).toHaveAttribute("href", "/privacy");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("reports the athlete's choice", () => {
    const onChange = vi.fn();
    render(<CoachStep aiCoachEnabled={false} onAiCoachEnabledChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /Turn on the AI Coach/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows an athlete who already turned it on as on", () => {
    render(<CoachStep aiCoachEnabled onAiCoachEnabledChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Turn on the AI Coach/ })).toBeChecked();
  });
});
