import type { GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

import { MAX_GENERATION_WAIT_MS, MAX_STATUS_OUTAGE_MS, useGeneratePlan } from "./usePlanGeneration";

vi.mock("@/hooks/use-toast", () => ({ useToast: vi.fn() }));

const PLAN_ID = "plan-1";
const input: GeneratePlanInput = {
  goal: "Sub-90 HYROX",
  daysPerWeek: 5,
  experienceLevel: "intermediate",
  startDate: "2026-10-12",
  endDate: "2026-12-06",
  endDateIsRaceDate: true,
};

// CL47 (CODEBASE_ANALYSIS_2026-10-03): polling had no cap and no error exit, so a
// job stranded by a worker crash kept the dialog generating until a reload.
describe("useGeneratePlan polling", () => {
  const toast = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(useToast).mockReturnValue({ toast } as unknown as ReturnType<typeof useToast>);
    vi.spyOn(api.plans, "generate").mockResolvedValue({
      id: PLAN_ID,
      days: [],
    } as unknown as TrainingPlanWithDays);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    toast.mockReset();
  });

  function renderGeneratePlan() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useGeneratePlan(), { wrapper });
  }

  async function startGenerating(onSuccess = vi.fn<(plan: TrainingPlanWithDays) => void>()) {
    const hook = renderGeneratePlan();
    act(() => {
      hook.result.current.mutate(input, { onSuccess });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.isPending).toBe(true);
    return { ...hook, onSuccess };
  }

  it("stops waiting and says so when the plan never settles", async () => {
    const status = vi
      .spyOn(api.plans, "getGenerationStatus")
      .mockResolvedValue({ planId: PLAN_ID, generationStatus: "generating" });
    const { result, onSuccess } = await startGenerating();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_GENERATION_WAIT_MS - 10_000);
    });
    expect(result.current.isPending).toBe(true);
    expect(toast).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(result.current.isPending).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Your plan is taking longer than usual" }),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    const pollsAtGiveUp = status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(status.mock.calls).toHaveLength(pollsAtGiveUp);
  });

  it("stops waiting with an error when the status can't be read", async () => {
    const status = vi
      .spyOn(api.plans, "getGenerationStatus")
      .mockRejectedValue(new Error("503: unavailable"));
    const { result } = await startGenerating();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_STATUS_OUTAGE_MS + 5_000);
    });

    expect(result.current.isPending).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't check on your plan", variant: "destructive" }),
    );
    const pollsAtGiveUp = status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(status.mock.calls).toHaveLength(pollsAtGiveUp);
  });

  it("lets the athlete start again once the watch is given up on", async () => {
    vi.spyOn(api.plans, "getGenerationStatus").mockRejectedValue(new Error("503: unavailable"));
    const { result } = await startGenerating();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_STATUS_OUTAGE_MS + 5_000);
    });
    expect(result.current.isPending).toBe(false);

    act(() => {
      result.current.mutate(input);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.plans.generate).toHaveBeenCalledTimes(2);
    expect(result.current.isPending).toBe(true);
  });

  it("rides out a brief outage and still delivers the plan", async () => {
    const plan = { id: PLAN_ID, days: [] } as unknown as TrainingPlanWithDays;
    vi.spyOn(api.plans, "get").mockResolvedValue(plan);
    vi.spyOn(api.plans, "getGenerationStatus")
      .mockRejectedValueOnce(new Error("503: unavailable"))
      .mockRejectedValueOnce(new Error("503: unavailable"))
      .mockResolvedValue({ planId: PLAN_ID, generationStatus: "ready" });
    const { result, onSuccess } = await startGenerating();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(onSuccess).toHaveBeenCalledWith(plan);
    expect(result.current.isPending).toBe(false);
    expect(toast).toHaveBeenCalledWith({ title: "Training plan generated successfully!" });
  });
});
