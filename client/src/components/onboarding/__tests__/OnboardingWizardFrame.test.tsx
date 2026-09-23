import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingWizardFrame } from "../OnboardingWizardFrame";

function renderFrame(onEnter = vi.fn()) {
  render(
    <OnboardingWizardFrame
      open
      onOpenChange={vi.fn()}
      title="Set Your Preferences"
      description="Units"
      step="units"
      steps={["welcome", "units"]}
      idx={1}
      total={2}
      footer={null}
      onEnter={onEnter}
    >
      <input aria-label="Age" type="number" />
      <button type="button">Pick</button>
    </OnboardingWizardFrame>,
  );
  return onEnter;
}

// No step is a form, so Enter in a field did nothing (onboarding audit M4).
describe("OnboardingWizardFrame keyboard", () => {
  it("moves on when Enter is pressed in a text field", () => {
    const onEnter = renderFrame();
    fireEvent.keyDown(screen.getByLabelText("Age"), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter on buttons and other keys alone", () => {
    const onEnter = renderFrame();
    fireEvent.keyDown(screen.getByRole("button", { name: "Pick" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Age"), { key: "Tab" });
    expect(onEnter).not.toHaveBeenCalled();
  });
});
