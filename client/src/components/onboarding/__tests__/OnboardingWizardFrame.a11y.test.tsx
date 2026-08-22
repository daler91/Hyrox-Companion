import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OnboardingWizardStep } from "@/hooks/onboardingTypes";

import { OnboardingWizardFrame } from "../OnboardingWizardFrame";

const STEPS: OnboardingWizardStep[] = ["welcome", "units", "goal", "plan", "schedule"];

function renderFrame(idx = 0) {
  const titles: Record<string, string> = {
    welcome: "Welcome to fitai.coach",
    units: "Set Your Preferences",
    goal: "What's Your Goal?",
    plan: "Choose Your Path",
    schedule: "When Do You Start?",
  };
  const step = STEPS[idx];
  return render(
    <OnboardingWizardFrame
      open
      onOpenChange={vi.fn()}
      title={titles[step]}
      description="Test description"
      step={step}
      steps={STEPS}
      idx={idx}
      total={STEPS.length}
      footer={<div>Footer</div>}
    >
      <div>Step content</div>
    </OnboardingWizardFrame>,
  );
}

describe("OnboardingWizardFrame accessibility", () => {
  it("has a live region that announces the current step to screen readers", () => {
    renderFrame(0);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent("Step 1 of 5: Welcome to fitai.coach");
  });

  it("updates the live region text when the step changes", () => {
    const { rerender } = renderFrame(0);

    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 5: Welcome to fitai.coach");

    rerender(
      <OnboardingWizardFrame
        open
        onOpenChange={vi.fn()}
        title="Set Your Preferences"
        description="Test description"
        step="units"
        steps={STEPS}
        idx={1}
        total={STEPS.length}
        footer={<div>Footer</div>}
      >
        <div>Step content</div>
      </OnboardingWizardFrame>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 5: Set Your Preferences");
  });
});
