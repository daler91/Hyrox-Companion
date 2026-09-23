import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";
import { api } from "@/lib/api";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    preferences: ["preferences"],
    authUser: ["authUser"],
    plans: ["plans"],
    timeline: ["timeline"],
  },
  api: {
    preferences: { update: vi.fn().mockResolvedValue({}) },
    plans: { createSample: vi.fn(), schedule: vi.fn(), deletePlan: vi.fn().mockResolvedValue({}) },
  },
}));

const samplePlan = {
  id: "sample-plan",
  userId: "user-1",
  name: "Sample Plan",
  sourceFileName: null,
  totalWeeks: 8,
  goal: null,
  startDate: null,
  endDate: null,
  raceDate: null,
  generationStatus: "ready",
  generationError: null,
  retiredOn: null,
  generationStartedAt: null,
};

function mockSamplePlanCreation() {
  vi.mocked(api.plans.createSample).mockResolvedValueOnce(samplePlan);
}

function renderOnboardingWizard(onComplete = vi.fn()) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useOnboardingWizard(onComplete), { wrapper }),
    onComplete,
  };
}

describe("useOnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("captures onboarding style and MAF payload when selecting maf_method", async () => {
    const { result } = renderOnboardingWizard();

    await act(async () => {
      await result.current.handleNext();
    }); // welcome -> units
    await act(async () => {
      await result.current.handleNext();
    }); // units -> goal

    act(() => {
      result.current.setTrainingStyleId("maf_method");
      result.current.setMafAge("40");
      result.current.setMafCategory("consistent_2y_plus_improving");
      result.current.setMafHrDataAvailable(true);
    });

    await act(async () => {
      await result.current.handleNext();
    }); // goal -> plan

    expect(api.preferences.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        trainingStyleId: "maf_method",
        mafAge: 40,
        mafCategory: "consistent_2y_plus_improving",
        mafHrDataAvailable: true,
        mafHr: 145,
      }),
    );
  });

  // Creating the template plan on the Plan step left an unscheduled copy
  // behind every time the athlete went Back and chose again (audit H3).
  it("creates the template plan only on Start Training, once, however often the athlete goes back", async () => {
    mockSamplePlanCreation();
    vi.mocked(api.plans.schedule).mockResolvedValueOnce(undefined);
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleUseSamplePlan();
    });
    expect(result.current.step).toBe("schedule");
    act(() => {
      result.current.handleBack();
    });
    act(() => {
      result.current.handleUseSamplePlan();
    });
    expect(api.plans.createSample).not.toHaveBeenCalled();

    act(() => {
      result.current.handleStartTraining();
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("sample"));
    expect(api.plans.createSample).toHaveBeenCalledTimes(1);
    expect(api.plans.schedule).toHaveBeenCalledWith("sample-plan", expect.any(String));
  });

  it("reuses the created plan when a failed schedule is retried", async () => {
    mockSamplePlanCreation();
    vi.mocked(api.plans.schedule)
      .mockRejectedValueOnce(new Error("500: boom"))
      .mockResolvedValueOnce(undefined);
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleUseSamplePlan();
    });
    act(() => {
      result.current.handleStartTraining();
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Failed to set up your plan", variant: "destructive" }),
      ),
    );

    act(() => {
      result.current.handleStartTraining();
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("sample"));
    expect(api.plans.createSample).toHaveBeenCalledTimes(1);
    expect(api.plans.schedule).toHaveBeenCalledTimes(2);
    expect(api.plans.deletePlan).not.toHaveBeenCalled();
  });

  it("discards a template plan whose schedule failed when the athlete leaves another way", async () => {
    mockSamplePlanCreation();
    vi.mocked(api.plans.schedule).mockRejectedValueOnce(new Error("500: boom"));
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleUseSamplePlan();
    });
    act(() => {
      result.current.handleStartTraining();
    });
    await waitFor(() => expect(api.plans.schedule).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isSchedulePending).toBe(false));

    act(() => {
      result.current.handleSkip();
    });

    expect(api.plans.deletePlan).toHaveBeenCalledWith("sample-plan");
    expect(onComplete).toHaveBeenCalledWith("skip");
  });

  // One Esc used to end onboarding for good with no word on how to come back
  // (audit H4); the wizard now confirms first, and leaving says where to go.
  it("says where to run setup again when the athlete leaves", () => {
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleLeaveSetup();
    });

    expect(onComplete).toHaveBeenCalledWith("skip");
    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(mockToast).toHaveBeenCalledWith({
      title: "Setup closed",
      description: "Run it again anytime from Settings → Account → Getting Started.",
    });
  });

  it("marks durable completion when skipping onboarding", () => {
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleSkip();
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    expect(onComplete).toHaveBeenCalledWith("skip");
  });

  it("marks durable completion when an AI plan is generated", () => {
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleGeneratedPlan();
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    expect(onComplete).toHaveBeenCalledWith("generated");
  });

  it("marks durable completion after scheduling a sample plan", async () => {
    mockSamplePlanCreation();
    vi.mocked(api.plans.schedule).mockResolvedValueOnce(undefined);
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleUseSamplePlan();
    });

    expect(result.current.step).toBe("schedule");

    act(() => {
      result.current.handleStartTraining();
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("sample");
    });
    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it("shows an error toast if prefsMutation fails on 'units' step, but still advances to 'goal' step", async () => {
    vi.mocked(api.preferences.update).mockRejectedValueOnce(new Error("Failed to update"));
    const { result } = renderOnboardingWizard();

    await act(async () => {
      await result.current.handleNext();
    }); // welcome -> units

    expect(result.current.step).toBe("units");

    // Only changed answers are written (onboarding audit H2), so change one.
    act(() => {
      result.current.setWeightUnit("lbs");
    });
    await act(async () => {
      await result.current.handleNext();
    }); // units -> goal (attempt)

    expect(mockToast).toHaveBeenCalledWith({
      title: "Could not save preferences",
      description: "You can update them later in settings.",
      variant: "destructive",
    });
    // Even if it fails, the current logic advances to "goal" step
    expect(result.current.step).toBe("goal");
  });

  it("shows an error toast and does not advance to 'plan' if prefsMutation fails on 'goal' step", async () => {
    const { result } = renderOnboardingWizard();

    await act(async () => {
      await result.current.handleNext();
    }); // welcome -> units
    await act(async () => {
      await result.current.handleNext();
    }); // units -> goal

    act(() => {
      result.current.setTrainingStyleId("maf_method");
      result.current.setMafAge("40");
      result.current.setMafCategory("consistent_up_to_2y");
    });
    vi.mocked(api.preferences.update).mockRejectedValueOnce(new Error("Failed to update"));

    await act(async () => {
      await result.current.handleNext();
    }); // goal -> next step (attempt)

    expect(mockToast).toHaveBeenCalledWith({
      title: "Could not save training style",
      description: "Please try again. You can also update this later in settings.",
      variant: "destructive",
    });
    // the code does NOT move on if the mutation fails
    expect(result.current.step).toBe("goal");
  });

  it("writes nothing when a step is left as saved", async () => {
    const { result } = renderOnboardingWizard();

    await act(async () => {
      await result.current.handleNext();
    }); // welcome -> units
    await act(async () => {
      await result.current.handleNext();
    }); // units -> goal
    await act(async () => {
      await result.current.handleNext();
    }); // goal -> next step

    expect(api.preferences.update).not.toHaveBeenCalled();
    expect(result.current.step).not.toBe("goal");
  });
});
