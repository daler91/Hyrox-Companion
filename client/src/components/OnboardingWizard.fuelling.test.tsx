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
// The real raceDateError stays: the wizard checks the race date with the
// step's own rule on Continue (CL9).
vi.mock("@/components/onboarding/GoalStep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/onboarding/GoalStep")>()),
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

  // Target writes only; the step also reads the current target.
  const targetsCalls = () =>
    vi
      .mocked(queryClientLib.apiRequest)
      .mock.calls.filter(
        ([method, url]) => method === "POST" && url === "/api/v1/nutrition/targets",
      );

  /** Answer GET /nutrition/targets with `current`; everything else succeeds. */
  const serveCurrentTarget = (current: Record<string, unknown> | null) => {
    vi.mocked(queryClientLib.apiRequest).mockImplementation(async (method, url) =>
      method === "GET" && url === "/api/v1/nutrition/targets"
        ? new Response(JSON.stringify({ current, history: current ? [current] : [] }))
        : new Response(JSON.stringify({ success: true })),
    );
  };

  /** The body of the one target write. */
  const postedTarget = () => targetsCalls()[0]?.[2] as Record<string, unknown> | undefined;

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
    // The day summary and Timeline chips carry the target too. CL19 (CODEBASE_ANALYSIS_2026-10-03)
    const invalidated = vi
      .mocked(queryClientLib.queryClient)
      .invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey);
    expect(invalidated).toContainEqual(QUERY_KEYS.nutritionDayPrefix);
    expect(invalidated).toContainEqual(QUERY_KEYS.nutritionRangePrefix);
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

  // A daily target already on file, periodised with the defaults for 400 g.
  const PERIODISED_TARGET = {
    id: "t1",
    userId: "u1",
    calories: 3000,
    proteinG: 160,
    carbG: 400,
    fatG: 80,
    periodizationEnabled: true,
    referenceUtss: 50,
    carbGramsPerUtss: 4,
    recoveryEnabled: true,
    recoveryProteinBumpFrac: 0.15,
    preloadCarbGramsPerUtss: 2,
    preloadDaysAhead: 1,
    phaseAware: true,
    maxCarbDeltaG: 300,
    effectiveFrom: "2026-06-01",
  };

  it("prefills a re-run from the saved profile and writes nothing when it is left alone", async () => {
    serveCurrentTarget(PERIODISED_TARGET);
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();
    // With targets on file, leaving the step alone must not replace them.
    await waitFor(() => {
      expect(screen.getByTestId("switch-fuelling-apply")).not.toBeChecked();
    });

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

  it("shows 12 inches or more as whole feet once the athlete leaves the field", async () => {
    queryClient.setQueryData(QUERY_KEYS.preferences, {
      weightUnit: "lbs",
      distanceUnit: "miles",
      onboardingCompleted: true,
    });
    renderComponent();
    await walkToFuellingStep();

    const feet = screen.getByTestId("input-fuelling-height-ft");
    const inches = screen.getByTestId("input-fuelling-height-in");
    fireEvent.change(feet, { target: { value: "5" } });
    fireEvent.change(inches, { target: { value: "14" } });
    fireEvent.blur(inches);

    expect(feet).toHaveValue(6);
    expect(inches).toHaveValue(2);
  });

  // CL20 (CODEBASE_ANALYSIS_2026-10-03)
  it("sets targets for an unchanged profile when the switch is on", async () => {
    // A profile saved in Settings, but no daily target yet: the switch starts on.
    serveCurrentTarget(null);
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();
    expect(screen.getByTestId("switch-fuelling-apply")).toBeChecked();

    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    expect(targetsCalls()).toHaveLength(1);
    // The profile itself is unchanged, so it is not re-saved.
    expect(queryClientLib.apiRequest).not.toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not replace targets it could not load over an unchanged profile", async () => {
    vi.mocked(queryClientLib.apiRequest).mockImplementation(async (method, url) => {
      if (method === "GET" && url === "/api/v1/nutrition/targets") throw new Error("500: down");
      return new Response(JSON.stringify({ success: true }));
    });
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();
    expect(screen.getByTestId("switch-fuelling-apply")).not.toBeChecked();

    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    expect(targetsCalls()).toHaveLength(0);
  });

  it("replaces an existing target on request even when the profile is unchanged", async () => {
    const user = userEvent.setup();
    serveCurrentTarget(PERIODISED_TARGET);
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();
    expect(await screen.findByText("Replace my daily targets with these")).toBeInTheDocument();

    await user.click(screen.getByTestId("switch-fuelling-apply"));
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    expect(targetsCalls()).toHaveLength(1);
  });

  it("carries the current periodisation forward, re-based, when a changed profile replaces targets", async () => {
    serveCurrentTarget(PERIODISED_TARGET);
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();
    expect(await screen.findByTestId("fuelling-keeps-periodization")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-fuelling-height"), { target: { value: "182" } });
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    const body = postedTarget();
    const ratio = Number(body?.carbG) / PERIODISED_TARGET.carbG;
    expect(body).toMatchObject({
      periodizationEnabled: true,
      referenceUtss: 50,
      recoveryEnabled: true,
      phaseAware: true,
      recoveryProteinBumpFrac: 0.15,
      preloadDaysAhead: 1,
      carbGramsPerUtss: Math.round(4 * ratio * 10) / 10,
      maxCarbDeltaG: Math.round(300 * ratio * 10) / 10,
    });
  });

  it("previews the calories it saves, at the goal rate set in Settings", async () => {
    serveCurrentTarget(null);
    queryClient.setQueryData(QUERY_KEYS.preferences, SAVED_PROFILE);
    renderComponent();
    await walkToFuellingStep();

    fireEvent.change(screen.getByTestId("input-fuelling-height"), { target: { value: "182" } });
    const preview = screen.getByTestId("fuelling-suggested-targets").textContent;
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("coach-step");

    // SAVED_PROFILE loses 0.5 kg/week; the preview used the 0.25 default.
    expect(preview).toContain(`${String(postedTarget()?.calories)} kcal`);
  });
});
