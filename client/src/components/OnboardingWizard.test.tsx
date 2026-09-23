import { nextPlanStartDate } from "@shared/dateUtils";
import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import * as queryClientLib from "@/lib/queryClient";
import {
  renderOnboardingWizard,
  resetOnboardingWizardMocks,
} from "@/test/support/onboardingWizardHarness";

// Mock child components to isolate OnboardingWizard
// This suite covers the base (non-fuelling) onboarding flow, so it pins the
// nutrition flag OFF explicitly; the suite runs ON by default now (vitest.config)
// and the fuelling step has its own suite in OnboardingWizard.fuelling.test.tsx.
vi.mock("@/lib/featureFlags", () => ({
  featureFlags: { nutritionEnabled: false, emomBuilderEnabled: false },
}));

vi.mock("@/components/onboarding/WelcomeStep", () => ({
  WelcomeStep: () => <div data-testid="welcome-step">WelcomeStep</div>,
}));
vi.mock("@/components/onboarding/UnitsStep", () => ({
  UnitsStep: ({
    weightUnit,
    distanceUnit,
    division,
    gender,
    onWeightUnitChange,
    onDistanceUnitChange,
  }: {
    weightUnit: string;
    distanceUnit: string;
    division: string;
    gender: string;
    onWeightUnitChange: (v: string) => void;
    onDistanceUnitChange: (v: string) => void;
  }) => (
    <div data-testid="units-step">
      <div data-testid="text-units-shown">{[weightUnit, distanceUnit, division, gender].join(",")}</div>
      <button onClick={() => onWeightUnitChange("lbs")}>Set Weight</button>
      <button onClick={() => onDistanceUnitChange("miles")}>Set Distance</button>
    </div>
  ),
}));
vi.mock("@/components/onboarding/GoalStep", () => ({
  GoalStep: ({
    selectedGoal,
    onGoalChange,
    trainingStyleId,
  }: {
    selectedGoal: string;
    onGoalChange: (goal: string) => void;
    trainingStyleId: string;
  }) => (
    <div data-testid="goal-step">
      <div data-testid="text-selected-goal">{selectedGoal}</div>
      <div data-testid="text-training-style">{trainingStyleId}</div>
      <button type="button" onClick={() => onGoalChange("endurance")}>
        Choose endurance
      </button>
    </div>
  ),
}));
vi.mock("@/components/plans/GeneratePlanDialog", () => ({
  GeneratePlanDialog: ({
    open,
    onGenerated,
    mode,
    initialGoal,
    initialStartDate,
    existingPlans,
    aiCoachEnabled,
  }: {
    open: boolean;
    onGenerated?: (plan: unknown) => void;
    mode?: string;
    initialGoal?: string;
    initialStartDate?: string;
    existingPlans?: readonly unknown[];
    aiCoachEnabled?: boolean;
  }) =>
    open ? (
      <div>
        <div data-testid="text-generate-ai-coach">{String(aiCoachEnabled)}</div>
        <div data-testid="text-generate-mode">{mode}</div>
        <div data-testid="text-generate-existing-plans">{existingPlans?.length ?? "none"}</div>
        <div data-testid="text-generate-goal">{initialGoal}</div>
        <div data-testid="text-generate-start-date">{initialStartDate}</div>
        <button
          type="button"
          data-testid="button-mock-generated-plan"
          onClick={() => onGenerated?.({ id: "generated-plan" })}
        >
          Finish generated plan
        </button>
      </div>
    ) : null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

// We need to mock the entire lib/queryClient module including apiRequest and queryClient
vi.mock("@/lib/queryClient", async () =>
  (await import("@/test/support/queryClientLibMock")).makeQueryClientLibMock(),
);

describe("OnboardingWizard Error Handling", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    queryClient = resetOnboardingWizardMocks(mockToast);
  });

  const renderComponent = () => renderOnboardingWizard(queryClient, mockOnComplete);

  it("shows error toast when preferences mutation fails", async () => {
    renderComponent();

    // The wizard starts at the 'welcome' step.
    // Click "Get Started" to move to 'units' step.
    fireEvent.click(screen.getByText("Get Started"));

    // Wait for the units step to render
    await screen.findByTestId("units-step");

    // Continue only writes what changed, so change something first; the
    // request for it fails.
    fireEvent.click(screen.getByText("Set Weight"));
    const { apiRequest } = await import("@/lib/queryClient");
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Failed to save preferences"));

    fireEvent.click(screen.getByText("Continue"));

    // Wait for the mutation to settle and toast to be called
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Could not save preferences",
        description: "You can update them later in settings.",
        variant: "destructive",
      });
    });

    // The step should advance to 'goal' step despite the error
    await screen.findByTestId("goal-step");
  });

  const walkToCoachStep = async () => {
    fireEvent.click(screen.getByText("Get Started"));
    await screen.findByTestId("units-step");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("goal-step");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("Meet Your AI Coach");
  };

  it("completes onboarding when an AI plan is generated", async () => {
    renderComponent();

    await walkToCoachStep();
    fireEvent.click(screen.getByText("Continue"));

    fireEvent.click(await screen.findByTestId("button-onboarding-generate-plan"));
    fireEvent.click(await screen.findByTestId("button-mock-generated-plan"));

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalledWith("generated");
    });
    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
  });

  // A new account's AI Coach is off, and the server refuses AI plans without
  // it: the recommended option used to be one that always failed (audit C1).
  it("leads with the template while the AI Coach is off, and says what the AI plan needs", async () => {
    renderComponent();

    await walkToCoachStep();
    fireEvent.click(screen.getByText("Continue"));

    const generateButton = await screen.findByTestId("button-onboarding-generate-plan");
    const sampleButton = screen.getByTestId("button-onboarding-sample-plan");
    expect(
      sampleButton.compareDocumentPosition(generateButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(generateButton).not.toHaveTextContent("recommended");
    expect(generateButton).toHaveTextContent("Needs the AI Coach");
    // The choice was left as saved, so nothing was written.
    expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
    // The Coaching Knowledge (RAG) note no longer sits at the decision point (M6).
    expect(screen.queryByText(/Coaching Knowledge/i)).not.toBeInTheDocument();
  });

  it("saves the AI Coach consent and then recommends the AI plan", async () => {
    renderComponent();

    await walkToCoachStep();
    fireEvent.click(screen.getByTestId("radio-coach-on"));
    expect(screen.getByText(/Your recent workout history/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Continue"));

    const generateButton = await screen.findByTestId("button-onboarding-generate-plan");
    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      { aiCoachEnabled: true },
      expect.anything(),
    );
    expect(generateButton).toHaveTextContent("Generate AI Plan (recommended)");
    expect(
      generateButton.compareDocumentPosition(screen.getByTestId("button-onboarding-sample-plan")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The generator is told, so it doesn't ask for the consent again.
    fireEvent.click(generateButton);
    expect(await screen.findByTestId("text-generate-ai-coach")).toHaveTextContent("true");
  });

  it("keeps the athlete on the coach step when the choice can't be saved", async () => {
    renderComponent();

    await walkToCoachStep();
    fireEvent.click(screen.getByTestId("radio-coach-on"));
    vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error("500: boom"));
    fireEvent.click(screen.getByText("Continue"));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not save your AI Coach choice" }),
      ),
    );
    expect(screen.getByText("Meet Your AI Coach")).toBeInTheDocument();
    expect(screen.queryByTestId("button-onboarding-generate-plan")).not.toBeInTheDocument();
  });

  it("passes the selected onboarding goal and start date into AI plan generation", async () => {
    renderComponent();

    fireEvent.click(screen.getByText("Get Started"));
    await screen.findByTestId("units-step");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("goal-step");
    fireEvent.click(screen.getByText("Choose endurance"));
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("Meet Your AI Coach");
    fireEvent.click(screen.getByText("Continue"));

    fireEvent.click(await screen.findByTestId("button-onboarding-generate-plan"));

    expect(await screen.findByTestId("text-generate-mode")).toHaveTextContent("onboarding");
    expect(screen.getByTestId("text-generate-goal")).toHaveTextContent("Improve endurance");
    // The next Monday (today, on a Monday): a Monday start keeps all of week 1
    // on the calendar (onboarding audit C3).
    expect(screen.getByTestId("text-generate-start-date")).toHaveTextContent(
      nextPlanStartDate(format(new Date(), "yyyy-MM-dd")),
    );
  });
});

// "Run setup again" and first runs alike: the wizard starts from what the
// athlete saved and writes only what they change (onboarding audit H2).
describe("OnboardingWizard saved preferences", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockOnComplete = vi.fn();

  const ESTABLISHED = {
    weightUnit: "lbs",
    distanceUnit: "miles",
    division: "pro",
    gender: "female",
    trainingStyleId: "maf_method",
    mafAge: 41,
    mafCategory: "consistent_up_to_2y",
    mafHrDataAvailable: true,
    onboardingCompleted: true,
    aiCoachEnabled: false,
  };

  beforeEach(() => {
    queryClient = resetOnboardingWizardMocks(mockToast);
  });

  const preferencePatches = () =>
    vi
      .mocked(queryClientLib.apiRequest)
      .mock.calls.filter(([method, url]) => method === "PATCH" && url === "/api/v1/preferences")
      .map(([, , body]) => body);

  const walkToPlanStep = async () => {
    fireEvent.click(screen.getByText("Get Started"));
    await screen.findByTestId("units-step");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("goal-step");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("Meet Your AI Coach");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("button-onboarding-generate-plan");
  };

  it("writes nothing when a first run keeps every default", async () => {
    renderOnboardingWizard(queryClient, mockOnComplete);
    await walkToPlanStep();
    expect(preferencePatches()).toEqual([]);
  });

  it("shows an established athlete's saved answers and writes nothing unchanged", async () => {
    queryClient.setQueryData(QUERY_KEYS.preferences, ESTABLISHED);
    renderOnboardingWizard(queryClient, mockOnComplete);

    fireEvent.click(screen.getByText("Get Started"));
    expect(await screen.findByTestId("text-units-shown")).toHaveTextContent("lbs,miles,pro,female");
    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByTestId("text-training-style")).toHaveTextContent("maf_method");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("Meet Your AI Coach");
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("button-onboarding-generate-plan");

    expect(preferencePatches()).toEqual([]);
  });

  it("sends only the field the athlete changed", async () => {
    queryClient.setQueryData(QUERY_KEYS.preferences, { ...ESTABLISHED, weightUnit: "kg" });
    renderOnboardingWizard(queryClient, mockOnComplete);

    fireEvent.click(screen.getByText("Get Started"));
    await screen.findByTestId("units-step");
    fireEvent.click(screen.getByText("Set Weight"));
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("goal-step");

    expect(preferencePatches()).toEqual([{ weightUnit: "lbs" }]);
  });

  it("suggests pounds and miles on an American first run, and saves them on Continue", async () => {
    // jsdom's navigator.languages is ["en-US", "en"].
    queryClient.setQueryData(QUERY_KEYS.preferences, {
      weightUnit: "kg",
      distanceUnit: "km",
      division: "open",
      gender: null,
      onboardingCompleted: false,
    });
    renderOnboardingWizard(queryClient, mockOnComplete);

    fireEvent.click(screen.getByText("Get Started"));
    expect(await screen.findByTestId("text-units-shown")).toHaveTextContent(
      "lbs,miles,open,prefer_not_to_say",
    );
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByTestId("goal-step");

    expect(preferencePatches()).toEqual([{ weightUnit: "lbs", distanceUnit: "miles" }]);
  });

  it("hands the athlete's plans to the generator so it can offer to archive an overlap", async () => {
    queryClient.setQueryData(QUERY_KEYS.preferences, ESTABLISHED);
    queryClient.setQueryData(QUERY_KEYS.plans, [{ id: "current-plan" }]);
    renderOnboardingWizard(queryClient, mockOnComplete);
    await walkToPlanStep();

    fireEvent.click(screen.getByTestId("button-onboarding-generate-plan"));
    expect(await screen.findByTestId("text-generate-existing-plans")).toHaveTextContent("1");
  });
});
