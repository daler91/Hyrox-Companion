import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToast } from "@/hooks/use-toast";
import * as queryClientLib from "@/lib/queryClient";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { OnboardingWizard } from "./OnboardingWizard";

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
vi.mock("@/components/onboarding/PlanStep", () => ({
  PlanStep: () => <div data-testid="plan-step">PlanStep</div>,
}));
vi.mock("@/components/plans/GeneratePlanDialog", () => ({
  GeneratePlanDialog: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}));

installRadixPointerMocks();

describe("OnboardingWizard fuelling step", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryClientLib.queryClient.invalidateQueries).mockResolvedValue(undefined);
    vi.mocked(queryClientLib.apiRequest).mockImplementation(async () =>
      new Response(JSON.stringify({ success: true })),
    );
    vi.mocked(useToast).mockReturnValue({ toast: mockToast } as unknown as ReturnType<
      typeof useToast
    >);
    localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <OnboardingWizard open={true} onComplete={mockOnComplete} />
      </QueryClientProvider>,
    );

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

  it("saves the body profile and sets the computed targets", async () => {
    const user = userEvent.setup();
    renderComponent();
    await walkToFuellingStep();

    fireEvent.change(screen.getByTestId("input-fuelling-bodyweight"), { target: { value: "80" } });
    fireEvent.change(screen.getByTestId("input-fuelling-height"), { target: { value: "180" } });
    fireEvent.change(screen.getByTestId("input-fuelling-age"), { target: { value: "30" } });
    await user.click(screen.getByTestId("select-fuelling-activity"));
    await user.click(await screen.findByText(/Moderately active/));

    // A complete profile shows the live suggested-targets preview.
    expect(await screen.findByTestId("fuelling-suggested-targets")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("plan-step");

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

    const callsBefore = vi.mocked(queryClientLib.apiRequest).mock.calls.length;
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("plan-step");

    expect(vi.mocked(queryClientLib.apiRequest).mock.calls.length).toBe(callsBefore);
    expect(targetsCalls()).toHaveLength(0);
  });

  it("saves the profile but not the targets when the suggestion is declined", async () => {
    const user = userEvent.setup();
    renderComponent();
    await walkToFuellingStep();

    fireEvent.change(screen.getByTestId("input-fuelling-bodyweight"), { target: { value: "80" } });
    fireEvent.change(screen.getByTestId("input-fuelling-height"), { target: { value: "180" } });
    fireEvent.change(screen.getByTestId("input-fuelling-age"), { target: { value: "30" } });
    await user.click(screen.getByTestId("select-fuelling-activity"));
    await user.click(await screen.findByText(/Moderately active/));
    await user.click(await screen.findByTestId("switch-fuelling-apply"));

    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("plan-step");

    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      expect.objectContaining({ bodyweightKg: 80 }),
      expect.anything(),
    );
    expect(targetsCalls()).toHaveLength(0);
  });
});
