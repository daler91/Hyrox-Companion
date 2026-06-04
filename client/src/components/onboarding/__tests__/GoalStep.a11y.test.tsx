import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { GoalStep } from "../GoalStep";
import { ONBOARDING_GOALS } from "../onboardingGoals";

function renderGoalStep(overrides: Record<string, unknown> = {}) {
  const props = {
    selectedGoal: "functional",
    onGoalChange: vi.fn(),
    trainingStyleId: "balanced_default",
    onTrainingStyleChange: vi.fn(),
    mafAge: "",
    onMafAgeChange: vi.fn(),
    mafInjuryIllnessMedication: false,
    onMafInjuryIllnessMedicationChange: vi.fn(),
    mafConsistency: "",
    onMafConsistencyChange: vi.fn(),
    mafTrend: "",
    onMafTrendChange: vi.fn(),
    mafHrDataAvailable: false,
    onMafHrDataAvailableChange: vi.fn(),
    ...overrides,
  };
  return render(<GoalStep {...props} />);
}

describe("GoalStep accessibility", () => {
  it("renders each goal as a radio with no nested interactive controls", async () => {
    const { container } = renderGoalStep();

    // Each goal is a real radio (was previously a <button> wrapping the Radix
    // radio's own <button> — invalid nesting).
    expect(screen.getAllByRole("radio")).toHaveLength(ONBOARDING_GOALS.length);

    // axe-core's `nested-interactive` rule fails on button-inside-button, so
    // this is the regression guard for the C1 onboarding fix.
    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives every MAF field an accessible name when MAF Method is selected", async () => {
    const { container } = renderGoalStep({ trainingStyleId: "maf_method" });

    expect(screen.getByRole("combobox", { name: "Training style" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Age" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Injury/illness/medication?" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Training consistency" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Recent trend" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "HR data available?" })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
