import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { downloadTemplate } from "@/components/timeline/timeline-filters/csv-utils";

import { PlanStep } from "../PlanStep";

vi.mock("@/components/timeline/timeline-filters/csv-utils", () => ({ downloadTemplate: vi.fn() }));

function renderPlanStep(aiCoachEnabled = false) {
  const handlers = {
    onUseSamplePlan: vi.fn(),
    onImportPlan: vi.fn(),
    onGeneratePlan: vi.fn(),
    onSkip: vi.fn(),
  };
  const view = render(<PlanStep aiCoachEnabled={aiCoachEnabled} {...handlers} />);
  return { ...view, handlers };
}

describe("PlanStep", () => {
  // Athletes without a file to hand cancelled the picker (audit M1).
  it("gives the CSV format and a template to download", () => {
    renderPlanStep();
    expect(screen.getByTestId("text-onboarding-csv-hint")).toHaveTextContent(
      "Columns: Week, Day, Focus, Main Workout, Accessory, Notes.",
    );
    fireEvent.click(screen.getByTestId("button-onboarding-csv-template"));
    expect(downloadTemplate).toHaveBeenCalled();
  });

  // The options used to stay on one line each and overflow a phone (audit H1).
  it("lets the option text wrap", () => {
    renderPlanStep();
    for (const id of ["button-onboarding-sample-plan", "button-onboarding-generate-plan", "button-onboarding-import"]) {
      expect(screen.getByTestId(id)).toHaveClass("whitespace-normal");
    }
  });

  it("says what the AI path involves when the coach is on", async () => {
    const { container } = renderPlanStep(true);
    expect(screen.getByTestId("button-onboarding-generate-plan")).toHaveTextContent(
      "Three quick questions",
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
