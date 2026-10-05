import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOverviewAnalysis } from "../useOverviewAnalysis";

const mocks = vi.hoisted(() => ({
  getOverviewAnalysis: vi.fn(),
  regenerateOverviewAnalysis: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: {
        ...actual.api.analytics,
        getOverviewAnalysis: mocks.getOverviewAnalysis,
        regenerateOverviewAnalysis: mocks.regenerateOverviewAnalysis,
      },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

function renderAnalysis(initialRange: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(({ range }: { range: string }) => useOverviewAnalysis(range), {
    wrapper,
    initialProps: { range: initialRange },
  });
}

// AI31 (CODEBASE_ANALYSIS_2026-10-03): the analysis reads the range the charts
// show, and one range's readings never paint under another range's charts.
describe("useOverviewAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("asks for the selected range and keeps each range's analysis apart", async () => {
    mocks.getOverviewAnalysis.mockImplementation((range: string) =>
      Promise.resolve(
        range === "90"
          ? { sections: { rpeDuration: "RPE near 7.6 over 90 days." }, rangeDays: 90 }
          : { sections: null },
      ),
    );

    const { result, rerender } = renderAnalysis("90");
    await waitFor(() =>
      expect(result.current.sections).toEqual({ rpeDuration: "RPE near 7.6 over 90 days." }),
    );
    expect(mocks.getOverviewAnalysis).toHaveBeenCalledWith("90");

    rerender({ range: "30" });
    await waitFor(() => expect(mocks.getOverviewAnalysis).toHaveBeenCalledWith("30"));
    await waitFor(() => expect(result.current.hasAnalysis).toBe(false));
    expect(result.current.sections).toBeNull();
  });

  it("generates for the selected range", async () => {
    mocks.getOverviewAnalysis.mockResolvedValue({ sections: null });
    mocks.regenerateOverviewAnalysis.mockResolvedValue({
      sections: { consistency: "Five sessions in the last 30 days." },
      rangeDays: 30,
      stale: false,
    });

    const { result } = renderAnalysis("30");
    await waitFor(() => expect(mocks.getOverviewAnalysis).toHaveBeenCalledWith("30"));

    act(() => {
      result.current.regenerate();
    });

    await waitFor(() =>
      expect(result.current.sections).toEqual({
        consistency: "Five sessions in the last 30 days.",
      }),
    );
    expect(mocks.regenerateOverviewAnalysis).toHaveBeenCalledWith("30");
  });
});
