import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimelineOnboardingWizard } from "../TimelineOnboardingWizard";

const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/components/OnboardingWizard", () => {
  loads.count += 1;
  return {
    OnboardingWizard: ({ open }: { open: boolean }) => (
      <div data-testid="onboarding-wizard" data-open={String(open)} />
    ),
  };
});

// The tests share one module load and run in order: the closed test must run
// before any test that opens the wizard and loads the module.
describe("TimelineOnboardingWizard", { shuffle: false }, () => {
  it("renders nothing and loads no wizard code while onboarding is closed", () => {
    const { container } = render(<TimelineOnboardingWizard open={false} onComplete={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(loads.count).toBe(0);
  });

  it("loads the wizard when it opens and keeps it mounted after it closes", async () => {
    const onComplete = vi.fn();
    const { rerender } = render(<TimelineOnboardingWizard open={false} onComplete={onComplete} />);

    rerender(<TimelineOnboardingWizard open onComplete={onComplete} />);
    expect(await screen.findByTestId("onboarding-wizard")).toHaveAttribute("data-open", "true");
    expect(loads.count).toBe(1);

    // Staying mounted lets the dialog play its close animation.
    rerender(<TimelineOnboardingWizard open={false} onComplete={onComplete} />);
    expect(screen.getByTestId("onboarding-wizard")).toHaveAttribute("data-open", "false");
  });
});
