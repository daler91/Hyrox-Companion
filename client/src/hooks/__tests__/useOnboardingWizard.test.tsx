import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";
import { api } from "@/lib/api";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/lib/api", () => ({
  QUERY_KEYS: { preferences: ["preferences"], authUser: ["authUser"], plans: ["plans"], timeline: ["timeline"] },
  api: {
    preferences: { update: vi.fn().mockResolvedValue({}) },
    plans: { createSample: vi.fn(), schedule: vi.fn() },
  },
}));

describe("useOnboardingWizard", () => {
  it("captures onboarding style and MAF payload when selecting maf_method", async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useOnboardingWizard(vi.fn()), { wrapper });

    await act(async () => { await result.current.handleNext(); }); // welcome -> units
    await act(async () => { await result.current.handleNext(); }); // units -> goal

    act(() => {
      result.current.setTrainingStyleId("maf_method");
      result.current.setMafAge("40");
      result.current.setMafConsistency("high");
      result.current.setMafTrend("improving");
      result.current.setMafHrDataAvailable(true);
    });

    await act(async () => { await result.current.handleNext(); }); // goal -> plan

    expect(api.preferences.update).toHaveBeenLastCalledWith(expect.objectContaining({
      trainingStyleId: "maf_method",
      mafAge: 40,
      mafConsistency: "high",
      mafTrend: "improving",
      mafHrDataAvailable: true,
      mafHr: 145,
    }));
  });
});
