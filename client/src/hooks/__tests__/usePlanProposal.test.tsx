import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type PlanProposalView } from "@/lib/api";

import { usePlanProposal } from "../usePlanProposal";

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      planProposals: { getPending: vi.fn(), get: vi.fn(), apply: vi.fn(), dismiss: vi.fn(), undo: vi.fn() },
    },
  };
});

vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: { invalidateQueries: vi.fn(() => Promise.resolve()) },
}));

const PROPOSAL = {
  id: "proposal-1",
  planId: "plan-1",
  status: "pending",
  summaryMessage: "Two changes.",
  changes: [
    { planDayId: "day-1", dayLabel: "Thu Oct 1 — Long Run", structured: false, updatedFields: { scheduledDate: "2026-10-03" } },
    { planDayId: "day-2", dayLabel: "Sat Oct 3 — Intervals", structured: false, updatedFields: { expectedRpe: 6 } },
  ],
  createdAt: "2026-10-01T10:00:00.000Z",
} as unknown as PlanProposalView;

function renderProposalHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const addLocalMessage = vi.fn();
  const saveMessage = vi.fn();
  const hook = renderHook(() => usePlanProposal({ addLocalMessage, saveMessage }), { wrapper });
  return { ...hook, addLocalMessage, saveMessage };
}

/** The text of the last message the hook added to the chat. */
function lastMessage(addLocalMessage: ReturnType<typeof vi.fn>): string {
  return (addLocalMessage.mock.calls.at(-1)?.[0] as { content: string }).content;
}

describe("usePlanProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.planProposals.getPending).mockResolvedValue({ proposal: null });
  });

  it("applies the changes the athlete picked, and keeps the card in reach for its Undo", async () => {
    vi.mocked(api.planProposals.apply).mockResolvedValue({ applied: true, changeCount: 1 });
    const { result, addLocalMessage, saveMessage } = renderProposalHook();

    act(() => {
      result.current.applyProposal(PROPOSAL, ["day-2"]);
    });

    await waitFor(() => {
      expect(addLocalMessage).toHaveBeenCalled();
    });
    expect(api.planProposals.apply).toHaveBeenCalledWith("proposal-1", ["day-2"]);
    expect(lastMessage(addLocalMessage)).toBe("Done — I've applied 1 of the 2 changes to your plan.");
    expect(saveMessage).toHaveBeenCalledWith({ role: "assistant", content: lastMessage(addLocalMessage) });
    // Nothing is pending any more; the applied proposal trails the chat instead.
    expect(result.current.proposal?.id).toBe("proposal-1");
  });

  it("says what an undo put back and what it left", async () => {
    vi.mocked(api.planProposals.undo).mockResolvedValue({
      undone: true,
      restoredCount: 2,
      keptDays: [{ planDayId: "day-1", dayLabel: "Thu Oct 1 — Long Run" }],
    });
    const { result, addLocalMessage, saveMessage } = renderProposalHook();

    act(() => {
      result.current.undoProposal({ ...PROPOSAL, status: "applied", appliedPlanDayIds: ["day-1", "day-2"] });
    });

    await waitFor(() => {
      expect(addLocalMessage).toHaveBeenCalled();
    });
    expect(api.planProposals.undo).toHaveBeenCalledWith("proposal-1");
    expect(lastMessage(addLocalMessage)).toBe(
      "Undone — I've put 2 days back the way they were. I left what's changed since on Thu Oct 1 — Long Run as it is.",
    );
    expect(saveMessage).toHaveBeenCalled();
  });

  it("passes on the server's reason when there is nothing to undo, without saving it", async () => {
    vi.mocked(api.planProposals.undo).mockRejectedValue(
      new Error('409: {"undone":false,"reason":"expired","message":"Those changes were applied more than a week ago."}'),
    );
    const { result, addLocalMessage, saveMessage } = renderProposalHook();

    act(() => {
      result.current.undoProposal({ ...PROPOSAL, status: "applied" });
    });

    await waitFor(() => {
      expect(addLocalMessage).toHaveBeenCalled();
    });
    expect(lastMessage(addLocalMessage)).toBe("Those changes were applied more than a week ago.");
    expect(saveMessage).not.toHaveBeenCalled();
  });
});
