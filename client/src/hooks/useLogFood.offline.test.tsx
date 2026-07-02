import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLog: vi.fn(),
  enqueueMutation: vi.fn(),
  createOfflineMutationId: vi.fn(() => "queued-id"),
  toast: vi.fn(),
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
vi.mock("@/lib/offlineQueue", () => ({
  enqueueMutation: mocks.enqueueMutation,
  createOfflineMutationId: mocks.createOfflineMutationId,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

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

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { value: online, configurable: true });
}

describe("useLogFood offline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOfflineMutationId.mockReturnValue("queued-id");
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
    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Food logged" }));
  });

  it("queues offline with the loggedAt preserved and a queued toast", async () => {
    setOnline(false);
    const { result } = renderHook(() => useLogFood("2026-05-16"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(mocks.createLog).not.toHaveBeenCalled();
    expect(mocks.enqueueMutation).toHaveBeenCalledWith(
      "POST",
      "/api/v1/nutrition/logs",
      input,
      { id: "queued-id" },
    );
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Food log queued" }),
    );
  });

  it("does not queue an application error", async () => {
    mocks.createLog.mockRejectedValue(new Error("400: Bad Request"));
    const { result } = renderHook(() => useLogFood("2026-05-16"), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow("400: Bad Request");
    });

    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
  });
});
