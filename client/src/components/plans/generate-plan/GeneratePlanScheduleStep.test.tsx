import type { TrainingPlan } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockTrainingPlan } from "../../../../../test/factories";
import { GeneratePlanScheduleStep } from "./GeneratePlanScheduleStep";

const baseProps = {
  daysPerWeek: 5,
  onDaysPerWeekChange: vi.fn(),
  restDays: [] as string[],
  requiredRestDays: 2,
  onRestDayToggle: vi.fn(),
  experienceLevel: "intermediate" as const,
  onExperienceLevelChange: vi.fn(),
  startDate: "2026-05-04",
  onStartDateChange: vi.fn(),
  endDate: "2026-06-29",
  onEndDateChange: vi.fn(),
  endDateIsRaceDate: true,
  onEndDateIsRaceDateChange: vi.fn(),
  planWeeks: 8,
  onBack: vi.fn(),
  onNext: vi.fn(),
  overlappingPlans: [] as TrainingPlan[],
  supersedePlanIds: [] as string[],
  onToggleSupersede: vi.fn(),
};

function plan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return createMockTrainingPlan({
    id: "old-plan",
    name: "Race Block",
    startDate: "2026-04-01",
    endDate: "2026-07-01",
    ...overrides,
  });
}

describe("GeneratePlanScheduleStep", () => {
  it("points aria-describedby at the date error when one is present", () => {
    render(<GeneratePlanScheduleStep {...baseProps} dateError="End date must be after start date" canProceed={false} />);

    const error = screen.getByRole("alert");
    expect(error).toHaveAttribute("id", "schedule-date-error");
    expect(error).toHaveTextContent("End date must be after start date");
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeDisabled();
    expect(nextButton).toHaveAttribute("aria-describedby", "schedule-date-error");
    // The rest-day hint should not also render — the date error takes priority.
    expect(screen.queryByText(/more rest day/)).not.toBeInTheDocument();
  });

  it("points aria-describedby at the rest-day hint when rest days are still needed", () => {
    render(
      <GeneratePlanScheduleStep
        {...baseProps}
        restDays={["Monday"]}
        requiredRestDays={2}
        dateError={null}
        canProceed={false}
      />,
    );

    const hint = screen.getByText("Select 1 more rest day to continue.");
    expect(hint).toHaveAttribute("id", "schedule-rest-hint");
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toHaveAttribute("aria-describedby", "schedule-rest-hint");
  });

  it("pluralizes the rest-day hint when more than one day is still needed", () => {
    render(
      <GeneratePlanScheduleStep
        {...baseProps}
        restDays={[]}
        requiredRestDays={2}
        dateError={null}
        canProceed={false}
      />,
    );

    expect(screen.getByText("Select 2 more rest days to continue.")).toBeInTheDocument();
  });

  it("omits the rest-day hint when no rest days are required, even if canProceed is false", () => {
    // requiredRestDays is 0 whenever the wizard's daysPerWeek is 7 — the
    // hook that owns canProceed treats that as satisfied regardless of
    // restDays, so in practice canProceed=false + requiredRestDays=0 only
    // happens if a future caller wires this prop combination up wrong.
    // Assert the component still degrades safely: no hint, no dangling
    // aria-describedby pointing at an element that was never rendered.
    render(
      <GeneratePlanScheduleStep
        {...baseProps}
        restDays={[]}
        requiredRestDays={0}
        dateError={null}
        canProceed={false}
      />,
    );

    expect(screen.queryByText(/more rest day/)).not.toBeInTheDocument();
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).not.toHaveAttribute("aria-describedby");
  });

  it("shows no hint and clears aria-describedby once the step can proceed", () => {
    render(
      <GeneratePlanScheduleStep
        {...baseProps}
        restDays={["Monday", "Tuesday"]}
        requiredRestDays={2}
        dateError={null}
        canProceed
      />,
    );

    expect(screen.queryByText(/more rest day/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeEnabled();
    expect(nextButton).not.toHaveAttribute("aria-describedby");
  });

  describe("superseding an overlapping plan", () => {
    it("offers to archive a plan the new one would overlap, on by default", () => {
      render(
        <GeneratePlanScheduleStep
          {...baseProps}
          overlappingPlans={[plan()]}
          supersedePlanIds={["old-plan"]}
          dateError={null}
          canProceed
        />,
      );

      const toggle = screen.getByTestId("switch-supersede-old-plan");
      expect(toggle).toBeInTheDocument();
      expect(screen.getByText("Race Block")).toBeInTheDocument();
      // Default on: switching is the normal reason to be generating a plan that
      // overlaps one already running.
      expect(toggle).toBeChecked();
    });

    it("reports the plan when the athlete opts to keep it running", async () => {
      const onToggleSupersede = vi.fn();
      render(
        <GeneratePlanScheduleStep
          {...baseProps}
          overlappingPlans={[plan()]}
          supersedePlanIds={["old-plan"]}
          onToggleSupersede={onToggleSupersede}
          dateError={null}
          canProceed
        />,
      );

      await userEvent.click(screen.getByTestId("switch-supersede-old-plan"));

      expect(onToggleSupersede).toHaveBeenCalledWith("old-plan");
    });

    it("says nothing when no existing plan overlaps", () => {
      render(<GeneratePlanScheduleStep {...baseProps} dateError={null} canProceed />);

      expect(screen.queryByText(/already on a plan/i)).not.toBeInTheDocument();
    });
  });
});