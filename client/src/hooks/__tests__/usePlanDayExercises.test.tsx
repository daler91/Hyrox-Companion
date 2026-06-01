import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { usePlanDayExercises } from "../usePlanDayExercises";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual("@/lib/api");
  return {
    ...actual,
    api: {
      plans: {
        getDayExercises: vi.fn(),
      },
    },
  };
});

describe("usePlanDayExercises data fetching error state", () => {
  it("mocks the data fetching function to reject and asserts the error state", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const error = new Error("Failed to fetch");
    vi.mocked(api.plans.getDayExercises).mockRejectedValueOnce(error);

    const { result } = renderHook(() => usePlanDayExercises("day-1"), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toEqual(error);
  });
});
