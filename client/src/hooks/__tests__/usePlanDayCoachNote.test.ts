import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { usePlanDayCoachNote } from "../usePlanDayCoachNote";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      plans: {
        ...actual.api.plans,
        regenerateCoachNote: vi.fn(),
      },
    },
  };
});

const mockPlans = api.plans as unknown as {
  regenerateCoachNote: ReturnType<typeof vi.fn>;
};

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { readonly children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("usePlanDayCoachNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets local rationale + updatedAt when planDayId changes", async () => {
    mockPlans.regenerateCoachNote.mockResolvedValue({
      planDayId: "plan-A",
      aiRationale: "Take A",
      aiNoteUpdatedAt: new Date().toISOString(),
    });

    // Dialog hoists usePlanDayCoachNote above Radix, which keeps the
    // dialog mounted while closed. Without the reset effect, the hook's
    // local state would bleed between entries — typed as a rerender
    // here.
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => usePlanDayCoachNote(id),
      {
        wrapper: wrapper(),
        initialProps: { id: "plan-A" },
      },
    );

    // Fire the mutation so the hook stashes a local rationale.
    await act(async () => {
      result.current.regenerate.mutate();
    });

    await waitFor(() => {
      expect(result.current.localRationale).toBe("Take A");
    });
    expect(result.current.localUpdatedAt).toBeInstanceOf(Date);

    // Switch plan days — the effect should reset the local override so
    // plan B's sidebar renders its own server rationale, not plan A's.
    rerender({ id: "plan-B" });

    expect(result.current.localRationale).toBeNull();
    expect(result.current.localUpdatedAt).toBeNull();
  });
});
