import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveWorkoutInput } from "./types";
import { useSaveWorkoutMutation } from "./useSaveWorkoutMutation";

const mocks = vi.hoisted(() => ({
  createWorkout: vi.fn(),
  enqueueMutation: vi.fn(),
  createOfflineMutationId: vi.fn(),
  invalidateWorkoutWriteQueries: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: {
        ...actual.api.workouts,
        create: mocks.createWorkout,
      },
    },
  };
});

vi.mock("@/lib/offlineQueue", () => ({
  createOfflineMutationId: mocks.createOfflineMutationId,
  enqueueMutation: mocks.enqueueMutation,
}));

vi.mock("@/lib/workoutInvalidation", () => ({
  invalidateWorkoutWriteQueries: mocks.invalidateWorkoutWriteQueries,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/log", mocks.navigate],
}));

const workoutPayload: SaveWorkoutInput = {
  title: "Offline test",
  date: "2026-05-16",
  focus: "Offline test",
  mainWorkout: "Run 5k",
  notes: null,
  rpe: null,
};

function renderMutation(onSaveSuccess = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    onSaveSuccess,
    ...renderHook(() => useSaveWorkoutMutation(onSaveSuccess), { wrapper }),
  };
}

function setOnline(value: boolean) {
  vi.spyOn(globalThis.navigator, "onLine", "get").mockReturnValue(value);
}

describe("useSaveWorkoutMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOfflineMutationId.mockReturnValue("offline-id-1");
    mocks.createWorkout.mockResolvedValue({ id: "workout-1" });
    setOnline(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends an idempotency key and invalidates on direct save success", async () => {
    const { result, onSaveSuccess } = renderMutation();

    await act(async () => {
      await result.current.mutateAsync(workoutPayload);
    });

    expect(mocks.createWorkout).toHaveBeenCalledWith(workoutPayload, { idempotencyKey: "offline-id-1" });
    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
    expect(mocks.invalidateWorkoutWriteQueries).toHaveBeenCalledOnce();
    expect(onSaveSuccess).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Workout logged",
      description: "Your workout has been saved successfully.",
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("queues without calling the API when the browser is offline", async () => {
    setOnline(false);
    const { result, onSaveSuccess } = renderMutation();

    await act(async () => {
      await result.current.mutateAsync(workoutPayload);
    });

    expect(mocks.createWorkout).not.toHaveBeenCalled();
    expect(mocks.enqueueMutation).toHaveBeenCalledWith(
      "POST",
      "/api/v1/workouts",
      workoutPayload,
      { id: "offline-id-1" },
    );
    expect(mocks.invalidateWorkoutWriteQueries).not.toHaveBeenCalled();
    expect(onSaveSuccess).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Workout queued",
      description: "We'll sync it automatically when your connection is back.",
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("queues connectivity failures with the same idempotency key used for the attempt", async () => {
    mocks.createWorkout.mockRejectedValueOnce(new DOMException("Request timed out", "TimeoutError"));
    const { result } = renderMutation();

    await act(async () => {
      await result.current.mutateAsync(workoutPayload);
    });

    expect(mocks.createWorkout).toHaveBeenCalledWith(workoutPayload, { idempotencyKey: "offline-id-1" });
    expect(mocks.enqueueMutation).toHaveBeenCalledWith(
      "POST",
      "/api/v1/workouts",
      workoutPayload,
      { id: "offline-id-1" },
    );
    expect(mocks.invalidateWorkoutWriteQueries).not.toHaveBeenCalled();
  });

  it("does not queue HTTP/application failures", async () => {
    mocks.createWorkout.mockRejectedValueOnce(new Error("500: Internal Server Error"));
    const { result } = renderMutation();

    await act(async () => {
      await expect(result.current.mutateAsync(workoutPayload)).rejects.toThrow("500: Internal Server Error");
    });

    await waitFor(() => {
      expect(mocks.enqueueMutation).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to save workout. Please try again.",
        variant: "destructive",
      });
    });
  });

  it("does not queue CSRF token HTTP failures", async () => {
    mocks.createWorkout.mockRejectedValueOnce(new Error("Failed to fetch CSRF token: 500"));
    const { result } = renderMutation();

    await act(async () => {
      await expect(result.current.mutateAsync(workoutPayload)).rejects.toThrow("Failed to fetch CSRF token: 500");
    });

    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
  });

  it("does not queue structured-row validation failures", async () => {
    mocks.createWorkout.mockRejectedValueOnce({ response: { data: { code: "STRUCTURED_ROWS_REQUIRED" } } });
    const { result } = renderMutation();

    await act(async () => {
      await expect(result.current.mutateAsync(workoutPayload)).rejects.toEqual({
        response: { data: { code: "STRUCTURED_ROWS_REQUIRED" } },
      });
    });

    await waitFor(() => {
      expect(mocks.enqueueMutation).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Workout needs structured rows",
        description: "Tap Parse or add at least one exercise set before saving.",
        variant: "destructive",
      });
    });
  });
});
