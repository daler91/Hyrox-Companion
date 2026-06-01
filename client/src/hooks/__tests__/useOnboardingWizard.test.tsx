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
    plans: { createSample: vi.fn(), schedule: vi.fn() },
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
      result.current.setMafConsistency("high");
      result.current.setMafTrend("improving");
      result.current.setMafHrDataAvailable(true);
    });

    await act(async () => {
      await result.current.handleNext();
    }); // goal -> plan

    expect(api.preferences.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        trainingStyleId: "maf_method",
        mafAge: 40,
        mafConsistency: "high",
        mafTrend: "improving",
        mafHrDataAvailable: true,
        mafHr: 145,
      }),
    );
  });

  it("does not complete onboarding when dismissing after template plan creation before scheduling", async () => {
    mockSamplePlanCreation();
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleUseSamplePlan();
    });

    await waitFor(() => {
      expect(result.current.step).toBe("schedule");
    });

    act(() => {
      result.current.handleDismissAttempt();
    });

    expect(result.current.step).toBe("schedule");
    expect(onComplete).not.toHaveBeenCalled();
    expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
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

    await waitFor(() => {
      expect(result.current.step).toBe("schedule");
    });

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

    vi.mocked(api.preferences.update).mockRejectedValueOnce(new Error("Failed to update"));

    await act(async () => {
      await result.current.handleNext();
    }); // goal -> plan (attempt)

    expect(mockToast).toHaveBeenCalledWith({
      title: "Could not save training style",
      description: "Please try again. You can also update this later in settings.",
      variant: "destructive",
    });
    // the code does NOT set step to "plan" if mutation fails
    expect(result.current.step).toBe("goal");
  });
});
