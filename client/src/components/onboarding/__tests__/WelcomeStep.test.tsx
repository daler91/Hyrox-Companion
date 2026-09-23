import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { WelcomeStep } from "../WelcomeStep";

describe("WelcomeStep", () => {
  // The step asked nothing and said nothing about time or privacy (audit L3),
  // and the privacy banner stays hidden while the wizard is open (audit M5).
  it("says how long setup takes and gives the privacy notice before any data is asked for", async () => {
    const { container } = render(<WelcomeStep />);

    expect(screen.getByTestId("text-onboarding-time-estimate")).toHaveTextContent("about 2 minutes");
    const link = screen.getByRole("link", { name: "Read our privacy policy" });
    expect(link).toHaveAttribute("href", "/privacy");
    // A new tab, so the wizard keeps its place.
    expect(link).toHaveAttribute("target", "_blank");
    expect(await axe(container)).toHaveNoViolations();
  });
});
