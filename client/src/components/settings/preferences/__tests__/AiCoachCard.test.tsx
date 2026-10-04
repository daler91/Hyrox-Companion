import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiCoachCard } from "../AiCoachCard";

function renderCard(aiCoachEnabled: boolean) {
  return render(
    <AiCoachCard
      aiCoachEnabled={aiCoachEnabled}
      onAiCoachEnabledChange={vi.fn()}
      coachAutoApplyPlanChanges={false}
      onCoachAutoApplyPlanChangesChange={vi.fn()}
    />,
  );
}

// P2 (CODEBASE_ANALYSIS_2026-10-03): aiCoachEnabled is the server's single
// consent gate for every AI provider call. It used to read only as "Auto-Adjust
// Workouts", so switching off auto-adjust silently cost chat, parsing and plan
// generation, and switching it on consented to all of it undisclosed.
describe("AiCoachCard", () => {
  it("presents the master switch as consent to AI data processing, naming what it covers", () => {
    renderCard(false);

    const toggle = screen.getByRole("switch", { name: /AI Coach and AI data processing/ });
    expect(toggle).toHaveAccessibleDescription(/send your training data to the AI provider/);
    expect(toggle).toHaveAccessibleDescription(/coach chat/);
    expect(toggle).toHaveAccessibleDescription(/parsing/);
    expect(toggle).toHaveAccessibleDescription(/automatic adjustments after each workout/);
    expect(screen.queryByText("Auto-Adjust Workouts")).not.toBeInTheDocument();
  });

  it("shows the onboarding disclosure of what is sent while the consent is on", () => {
    renderCard(true);

    const details = screen.getByTestId("settings-ai-consent-details");
    expect(details).toHaveTextContent(/the following data is sent for processing/);
    expect(details).toHaveTextContent(/Chat messages you send to the coach/);
  });

  it("hides the disclosure while the consent is off", () => {
    renderCard(false);

    expect(screen.queryByTestId("settings-ai-consent-details")).not.toBeInTheDocument();
  });
});
