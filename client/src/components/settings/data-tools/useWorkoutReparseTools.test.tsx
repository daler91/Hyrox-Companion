import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { apiRequest,queryClient as mockQueryClient } from "@/lib/queryClient";

import { useWorkoutReparseTools } from "./useWorkoutReparseTools";

vi.mock("@/lib/api", () => ({
  api: {
    workouts: {
      batchReparse: vi.fn(),
    },
  },
  QUERY_KEYS: {
    timeline: "timeline",
    workouts: "workouts",
    personalRecords: "personalRecords",
    exerciseAnalytics: "exerciseAnalytics",
  }
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

describe("useWorkoutReparseTools", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.mocked(useToast).mockReturnValue({ toast: mockToast } as any);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("should initialize with null state", () => {
    const { result } = renderHook(() => useWorkoutReparseTools(), { wrapper });

    expect(result.current.unstructuredCount).toBeNull();
    expect(result.current.parseResults).toBeNull();
  });

  it("should handle findUnstructuredMutation success", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => [{ id: "1" }, { id: "2" }],
    } as any);

    const { result } = renderHook(() => useWorkoutReparseTools(), { wrapper });

    act(() => {
      result.current.findUnstructuredMutation.mutate();
    });

    await waitFor(() => {
      expect(result.current.findUnstructuredMutation.isSuccess).toBe(true);
    });

    expect(result.current.unstructuredCount).toBe(2);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Search Complete",
      description: "Found 2 workouts without structured exercise data.",
    });
  });

  it("should handle findUnstructuredMutation error", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("API Error"));

    const { result } = renderHook(() => useWorkoutReparseTools(), { wrapper });

    act(() => {
      result.current.findUnstructuredMutation.mutate();
    });

    await waitFor(() => {
      expect(result.current.findUnstructuredMutation.isError).toBe(true);
    });

    expect(result.current.unstructuredCount).toBeNull();
    expect(mockToast).toHaveBeenCalledWith({
      title: "Search Failed",
      description: "Failed to find unstructured workouts.",
      variant: "destructive",
    });
  });

  it("should handle batchReparseMutation success and handle catch blocks in invalidateQueries", async () => {
    vi.mocked(api.workouts.batchReparse).mockResolvedValueOnce({
      parsed: 5,
      failed: 1,
    });
    // Trigger catch block in invalidateQueries
    vi.mocked(mockQueryClient.invalidateQueries).mockRejectedValue(new Error("Cache Error"));

    const { result } = renderHook(() => useWorkoutReparseTools(), { wrapper });

    act(() => {
      result.current.batchReparseMutation.mutate();
    });

    await waitFor(() => {
      expect(result.current.batchReparseMutation.isSuccess).toBe(true);
    });

    expect(result.current.parseResults).toEqual({ success: 5, failed: 1 });
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledTimes(4);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Parsing Complete",
      description: "Parsed 5 workouts successfully. 1 could not be parsed.",
    });
  });

  it("should handle batchReparseMutation error", async () => {
    vi.mocked(api.workouts.batchReparse).mockRejectedValueOnce(new Error("API Error"));

    const { result } = renderHook(() => useWorkoutReparseTools(), { wrapper });

    act(() => {
      result.current.batchReparseMutation.mutate();
    });

    await waitFor(() => {
      expect(result.current.batchReparseMutation.isError).toBe(true);
    });

    expect(result.current.parseResults).toBeNull();
    expect(mockToast).toHaveBeenCalledWith({
      title: "Parsing Failed",
      description: "Failed to parse workouts with AI.",
      variant: "destructive",
    });
  });

  it("should reset state", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => [{ id: "1" }],
    } as any);
    vi.mocked(api.workouts.batchReparse).mockResolvedValueOnce({
      parsed: 1,
      failed: 0,
    });
    vi.mocked(mockQueryClient.invalidateQueries).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkoutReparseTools(), { wrapper });

    act(() => {
      result.current.findUnstructuredMutation.mutate();
    });

    await waitFor(() => {
      expect(result.current.findUnstructuredMutation.isSuccess).toBe(true);
    });

    act(() => {
      result.current.batchReparseMutation.mutate();
    });

    await waitFor(() => {
      expect(result.current.batchReparseMutation.isSuccess).toBe(true);
    });

    expect(result.current.unstructuredCount).toBe(1);
    expect(result.current.parseResults).toEqual({ success: 1, failed: 0 });

    act(() => {
      result.current.reset();
    });

    expect(result.current.unstructuredCount).toBeNull();
    expect(result.current.parseResults).toBeNull();
  });
});
