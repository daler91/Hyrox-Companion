import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeWrapper,
  offlineMocks,
  setOnline,
} from "@/test/support/offlineMutationHarness";

const mocks = vi.hoisted(() => ({
  createLog: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      nutrition: { ...actual.api.nutrition, createLog: mocks.createLog },
    },
  };
});
vi.mock("@/lib/offlineQueue", async () =>
  (await import("@/test/support/offlineMutationHarness")).makeOfflineQueueMock(),
);
vi.mock("@/hooks/use-toast", async () =>
  (await import("@/test/support/offlineMutationHarness")).makeOfflineToastMock(),
);

let queryClient: QueryClient;
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: {
    invalidateQueries: (...args: unknown[]) => queryClient.invalidateQueries(...(args as [never])),
  },
}));

import { useLogFood } from "./useNutrition";

const input = {
  foodId: "food-1",
  quantityG: 100,
  mealType: "breakfast" as const,
  loggedAt: "2026-05-16T08:00:00.000Z",
};

const wrapper = makeWrapper(() => queryClient);

describe("useLogFood offline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offlineMocks.createOfflineMutationId.mockReturnValue("queued-id");
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    setOnline(true);
  });

  afterEach(() => setOnline(true));

  it("logs online and returns a saved result", async () => {
    mocks.createLog.mockResolvedValue({ id: "log-1" });
    const { result } = renderHook(() => useLogFood("2026-05-16"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(mocks.createLog).toHaveBeenCalledWith(input, { idempotencyKey: "queued-id" });
    expect(offlineMocks.enqueueMutation).not.toHaveBeenCalled();
    expect(offlineMocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Food logged" }));
  });

  it("queues offline with the loggedAt preserved and a queued toast", async () => {
    setOnline(false);
    const { result } = renderHook(() => useLogFood("2026-05-16"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(mocks.createLog).not.toHaveBeenCalled();
    expect(offlineMocks.enqueueMutation).toHaveBeenCalledWith(
      "POST",
      "/api/v1/nutrition/logs",
      input,
      { id: "queued-id" },
    );
    expect(offlineMocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Food log queued" }),
    );
  });

  it("does not queue an application error", async () => {
    mocks.createLog.mockRejectedValue(new Error("400: Bad Request"));
    const { result } = renderHook(() => useLogFood("2026-05-16"), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow("400: Bad Request");
    });

    expect(offlineMocks.enqueueMutation).not.toHaveBeenCalled();
  });
});
