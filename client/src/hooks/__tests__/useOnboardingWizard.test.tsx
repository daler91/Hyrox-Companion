import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOnboardingWizard } from "../useOnboardingWizard";
import { api, QUERY_KEYS } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import React from "react";

// Mock the API correctly by spying on the actual api object
vi.mock("@/lib/api", () => ({
  api: {
    preferences: {
      update: vi.fn(),
    },
    plans: {
      createSample: vi.fn(),
      schedule: vi.fn(),
    },
  },
  QUERY_KEYS: {
    preferences: ["preferences"],
    authUser: ["authUser"],
    plans: ["plans"],
    timeline: ["timeline"],
  },
}));

// Mock useToast
vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

describe("useOnboardingWizard", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toast: mockToast,
    });

    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("initializes with correct default state", () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });

    expect(result.current.step).toBe("welcome");
    expect(result.current.idx).toBe(0);
    expect(result.current.total).toBe(4);
    expect(result.current.weightUnit).toBe("kg");
    expect(result.current.distanceUnit).toBe("km");
    expect(result.current.selectedGoal).toBe("first");
  });

  it("navigates through steps correctly", async () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });

    // welcome -> units
    act(() => {
      result.current.handleNext();
    });
    expect(result.current.step).toBe("units");

    // Mock successful preference update
    (api.preferences.update as any).mockResolvedValueOnce({});

    // units -> goal
    await act(async () => {
      await result.current.handleNext();
    });

    expect(api.preferences.update).toHaveBeenCalledWith({
      weightUnit: "kg",
      distanceUnit: "km",
    });
    expect(result.current.step).toBe("goal");

    // goal -> plan
    act(() => {
      result.current.handleNext();
    });
    expect(result.current.step).toBe("plan");

    // test handleBack
    act(() => {
      result.current.handleBack();
    });
    expect(result.current.step).toBe("goal");
  });

  it("handles preference update failure gracefully", async () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });

    // go to units step
    act(() => {
      result.current.handleNext();
    });

    // Mock failed preference update
    (api.preferences.update as any).mockRejectedValueOnce(new Error("Failed"));

    await act(async () => {
      await result.current.handleNext();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Could not save preferences",
        variant: "destructive",
      })
    );
    // Should still proceed to goal step even if prefs fail
    expect(result.current.step).toBe("goal");
  });

  it("handles skipping the wizard", () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });

    act(() => {
      result.current.handleSkip();
    });

    expect(localStorage.getItem("hyrox-onboarding-complete")).toBe("true");
    expect(mockOnComplete).toHaveBeenCalledWith("skip");
  });

  it("handles importing a plan", () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });

    act(() => {
      result.current.handleImportPlan();
    });

    expect(localStorage.getItem("hyrox-onboarding-complete")).toBe("true");
    expect(mockOnComplete).toHaveBeenCalledWith("import");
  });

  const setupSamplePlan = async () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });
    const mockPlan = { id: "plan-123" };
    (api.plans.createSample as any).mockResolvedValueOnce(mockPlan);

    act(() => {
      result.current.handleUseSamplePlan();
    });

    await waitFor(() => {
      expect(result.current.step).toBe("schedule");
    });

    return result;
  };

  it("handles creating a sample plan successfully", async () => {
    const result = await setupSamplePlan();

    expect(api.plans.createSample).toHaveBeenCalled();
    expect(result.current.isSamplePending).toBe(false);
    expect(result.current.total).toBe(5);
  });

  it("handles sample plan creation failure", async () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });

    (api.plans.createSample as any).mockRejectedValueOnce(new Error("Failed"));

    act(() => {
      result.current.handleUseSamplePlan();
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to create plan",
          variant: "destructive",
        })
      );
    });
  });

  it("handles starting training successfully", async () => {
    const result = await setupSamplePlan();

    // Action: schedule the plan
    (api.plans.schedule as any).mockResolvedValueOnce({});

    act(() => {
      result.current.handleStartTraining();
    });

    await waitFor(() => {
      expect(result.current.isSchedulePending).toBe(false);
    });

    expect(api.plans.schedule).toHaveBeenCalledWith("plan-123", expect.any(String));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Your training plan is ready!",
      })
    );
    expect(localStorage.getItem("hyrox-onboarding-complete")).toBe("true");
    expect(mockOnComplete).toHaveBeenCalledWith("sample");
  });

  it("handles starting training failure", async () => {
    const result = await setupSamplePlan();

    // Action: schedule the plan fails
    (api.plans.schedule as any).mockRejectedValueOnce(new Error("Failed"));

    act(() => {
      result.current.handleStartTraining();
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to schedule plan",
          variant: "destructive",
        })
      );
    });
  });

  it("does not schedule if createdPlanId is null", () => {
    const { result } = renderHook(() => useOnboardingWizard(mockOnComplete), { wrapper });

    // Call start training directly without creating a plan first
    act(() => {
      result.current.handleStartTraining();
    });

    expect(api.plans.schedule).not.toHaveBeenCalled();
  });
});
