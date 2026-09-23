import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import * as queryClientLib from "@/lib/queryClient";
import {
  renderOnboardingWizard,
  resetOnboardingWizardMocks,
} from "@/test/support/onboardingWizardHarness";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

// The fuelling step only exists when the nutrition module is enabled; the
// suite-wide default is off (vitest.config), so force it on here.
vi.mock("@/lib/featureFlags", () => ({
  featureFlags: { nutritionEnabled: true, emomBuilderEnabled: false },
}));

vi.mock("@/components/onboarding/WelcomeStep", () => ({
  WelcomeStep: () => <div data-testid="welcome-step">WelcomeStep</div>,
}));
vi.mock("@/components/onboarding/UnitsStep", () => ({
  UnitsStep: () => <div data-testid="units-step">UnitsStep</div>,
}));
vi.mock("@/components/onboarding/GoalStep", () => ({
  GoalStep: () => <div data-testid="goal-step">GoalStep</div>,
}));
vi.mock("@/components/onboarding/CoachStep", () => ({
  CoachStep: () => <div data-testid="coach-step">CoachStep</div>,
}));
vi.mock("@/components/onboarding/PlanStep", () => ({
  PlanStep: () => <div data-testid="plan-step">PlanStep</div>,
}));
vi.mock("@/components/plans/GeneratePlanDialog", () => ({
  GeneratePlanDialog: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", async () =>
  (await import("@/test/support/queryClientLibMock")).makeQueryClientLibMock(),
);

installRadixPointerMocks();

describe("OnboardingWizard fuelling step", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    queryClient = resetOnboardingWizardMocks(mockToast);
  });

  const renderComponent = () => renderOnboardingWizard(queryClient, mockOnComplete);

  const walkToFuellingStep = async () => {
    fireEvent.click(screen.getByText("Get Started"));
    await screen.findByTestId("units-step");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("goal-step");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("input-fuelling-bodyweight");
  };

  const targetsCalls = () =>
    vi
      .mocked(queryClientLib.apiRequest)
      .mock.calls.filter(([, url]) => url === "/api/v1/nutrition/targets");

  const fillCompleteProfile = async (user: ReturnType<typeof userEvent.setup>) => {
    fireEvent.change(screen.getByTestId("input-fuelling-bodyweight"), { target: { value: "80" } });
    fireEvent.change(screen.getByTestId("input-fuelling-height"), { target: { value: "180" } });
    fireEvent.change(screen.getByTestId("input-fuelling-age"), { target: { value: "30" } });
    await user.click(screen.getByTestId("select-fuelling-activity"));
    await user.click(await screen.findByText(/Moderately active/));
  };

  it("saves the body profile and sets the computed targets", async () => {
    const user = userEvent.setup();
    renderComponent();
    await walkToFuellingStep();

    await fillCompleteProfile(user);

    // A complete profile shows the live suggested-targets preview.
    expect(await screen.findByTestId("fuelling-suggested-targets")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      expect.objectContaining({
        bodyweightKg: 80,
        heightCm: 180,
        age: 30,
        activityLevel: "moderate",
        weightGoalDirection: "maintain",
      }),
      expect.anything(),
    );
    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/v1/nutrition/targets",
      expect.objectContaining({
        calories: expect.any(Number),
        proteinG: expect.any(Number),
        carbG: expect.any(Number),
        fatG: expect.any(Number),
      }),
      expect.anything(),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Daily fuelling targets set" }),
      ),
    );
  });

  it("skips straight to the plan step when left blank, writing nothing", async () => {
    renderComponent();
    await walkToFuellingStep();

    // Nothing will be saved, so the button says so (audit L5).
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
    const callsBefore = vi.mocked(queryClientLib.apiRequest).mock.calls.length;
    fireEvent.click(screen.getByText("Skip"));
    await screen.findByTestId("coach-step");

    expect(vi.mocked(queryClientLib.apiRequest).mock.calls).toHaveLength(callsBefore);
    expect(targetsCalls()).toHaveLength(0);
  });

  it("saves the profile but not the targets when the suggestion is declined", async () => {
    const user = userEvent.setup();
    renderComponent();
    await walkToFuellingStep();

    await fillCompleteProfile(user);
    await user.click(await screen.findByTestId("switch-fuelling-apply"));

    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      expect.objectContaining({ bodyweightKg: 80 }),
      expect.anything(),
    );
    expect(targetsCalls()).toHaveLength(0);
  });

  // "Run setup again": the step arrives prefilled with the saved profile.
  const SAVED_PROFILE = {
    weightUnit: "kg",
    distanceUnit: "km",
    onboardingCompleted: true,
    bodyweightKg: 80.37,
    heightCm: 180,
    age: 30,
    activityLevel: "moderate",
    weightGoalDirection: "lose",
    weightGoalRateKgPerWeek: 0.5,
  };

  it("prefills a re-run from the saved profile and writes nothing when it is left alone", async () => {
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();

    expect(screen.getByTestId("input-fuelling-bodyweight")).toHaveValue(80.4);
    expect(screen.getByTestId("input-fuelling-height")).toHaveValue(180);
    expect(screen.getByTestId("input-fuelling-age")).toHaveValue(30);

    const callsBefore = vi.mocked(queryClientLib.apiRequest).mock.calls.length;
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    // Neither the profile nor the athlete's own targets are rewritten.
    expect(vi.mocked(queryClientLib.apiRequest).mock.calls).toHaveLength(callsBefore);
    expect(targetsCalls()).toHaveLength(0);
  });

  it("keeps the saved bodyweight and goal rate when another field changes", async () => {
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();

    fireEvent.change(screen.getByTestId("input-fuelling-height"), { target: { value: "182" } });
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      expect.objectContaining({
        bodyweightKg: 80.37,
        heightCm: 182,
        weightGoalDirection: "lose",
        weightGoalRateKgPerWeek: 0.5,
      }),
      expect.anything(),
    );
  });

  // Imperial athletes had to type centimetres here (audit L4).
  it("takes height in feet and inches from an athlete who weighs in pounds", async () => {
    const user = userEvent.setup();
    queryClient.setQueryData(QUERY_KEYS.preferences, {
      weightUnit: "lbs",
      distanceUnit: "miles",
      onboardingCompleted: true,
    });
    renderComponent();
    await walkToFuellingStep();

    expect(screen.queryByTestId("input-fuelling-height")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("input-fuelling-bodyweight"), { target: { value: "176" } });
    fireEvent.change(screen.getByTestId("input-fuelling-height-ft"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("input-fuelling-height-in"), { target: { value: "11" } });
    fireEvent.change(screen.getByTestId("input-fuelling-age"), { target: { value: "30" } });
    await user.click(screen.getByTestId("select-fuelling-activity"));
    await user.click(await screen.findByText(/Moderately active/));

    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      expect.objectContaining({ heightCm: 180.3, bodyweightKg: 79.8 }),
      expect.anything(),
    );
  });
});
