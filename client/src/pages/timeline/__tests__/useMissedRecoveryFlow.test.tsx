import type { TimelineEntry } from "@shared/schema";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMissedRecoveryFlow } from "../useMissedRecoveryFlow";

const mocks = vi.hoisted(() => ({ applyRecovery: vi.fn() }));

vi.mock("@/hooks/useMissedRecovery", () => ({
  useApplyMissedRecovery: () => ({ mutateAsync: mocks.applyRecovery }),
}));

/** A promise the test settles by hand, standing in for the request in flight. */
function deferred() {
  const settle: { resolve?: (value: unknown) => void; reject?: (reason: Error) => void } = {};
  const promise = new Promise<unknown>((resolve, reject) => {
    settle.resolve = resolve;
    settle.reject = reject;
  });
  return { promise, settle };
}

function letGoEntry(planDayId: string): TimelineEntry {
  return {
    id: `plan-${planDayId}`,
    date: "2026-10-01",
    planDayId,
    status: "skipped",
    recovery: "let_go",
  } as unknown as TimelineEntry;
}

// CL72 (CODEBASE_ANALYSIS_2026-10-03): a double tap on Undo sent two reopens,
// and the second's error toast sat beside the first's success toast.
describe("useMissedRecoveryFlow undo", () => {
  beforeEach(() => {
    mocks.applyRecovery.mockReset();
  });

  it("sends one reopen however many times Undo is tapped while it is in flight", async () => {
    const request = deferred();
    mocks.applyRecovery.mockReturnValue(request.promise);
    const { result } = renderHook(() => useMissedRecoveryFlow());

    result.current.recover(letGoEntry("pd-1"), "reopen");
    result.current.recover(letGoEntry("pd-1"), "reopen");

    expect(mocks.applyRecovery).toHaveBeenCalledTimes(1);
    expect(mocks.applyRecovery).toHaveBeenCalledWith({
      planDayId: "pd-1",
      body: { action: "reopen" },
      undoing: undefined,
    });

    await act(async () => {
      request.settle.resolve?.({});
      await request.promise;
    });
  });

  it("takes Undo again once the reopen has settled, even after a failure", async () => {
    const failed = deferred();
    mocks.applyRecovery.mockReturnValueOnce(failed.promise).mockResolvedValueOnce({});
    const { result } = renderHook(() => useMissedRecoveryFlow());

    result.current.recover(letGoEntry("pd-1"), "reopen");
    await act(async () => {
      failed.settle.reject?.(new Error("offline"));
      await failed.promise.catch(() => null);
    });
    result.current.recover(letGoEntry("pd-1"), "reopen");

    expect(mocks.applyRecovery).toHaveBeenCalledTimes(2);
  });

  it("does not hold back a different session's Undo", () => {
    mocks.applyRecovery.mockReturnValue(deferred().promise);
    const { result } = renderHook(() => useMissedRecoveryFlow());

    result.current.recover(letGoEntry("pd-1"), "reopen");
    result.current.recover(letGoEntry("pd-2"), "reopen");

    expect(mocks.applyRecovery).toHaveBeenCalledTimes(2);
  });
});
