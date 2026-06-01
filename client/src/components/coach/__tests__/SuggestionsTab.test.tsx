import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act,renderHook, waitFor } from "@testing-library/react";
import { beforeEach,describe, expect, it, vi } from "vitest";

import type { Suggestion } from "@/lib/api";
import { api } from "@/lib/api";
import { AiBudgetExceededError, RateLimitError } from "@/lib/queryClient";

import { useSuggestions } from "../SuggestionsTab";

// Mock the API
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual("@/lib/api");
  return {
    ...actual,
    api: {
      timeline: {
        getSuggestions: vi.fn(),
        applySuggestion: vi.fn(),
      },
    },
    QUERY_KEYS: {
      timeline: "timeline",
      planDayExercises: vi.fn(),
      exerciseAnalytics: "exerciseAnalytics",
      personalRecords: "personalRecords",
    },
  };
});

// We also need to mock `queryClient` from `@/lib/queryClient` since it's used inside handleApplySuggestion
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual("@/lib/queryClient");
  return {
    ...actual,
    queryClient: {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("useSuggestions error handling", () => {
  let queryClient: QueryClient;
  const mockAddLocalMessage = vi.fn();
  const mockSaveMessage = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const renderSuggestionsHook = (timeline = []) => {
    return renderHook(
      () =>
        useSuggestions({
          timeline,
          addLocalMessage: mockAddLocalMessage,
          saveMessage: mockSaveMessage,
        }),
      { wrapper }
    );
  };

  describe("getSuggestions error handling", () => {
    it("handles AiBudgetExceededError correctly", async () => {
      vi.mocked(api.timeline.getSuggestions).mockRejectedValueOnce(
        new AiBudgetExceededError("Budget exceeded", 100, 100)
      );

      const { result } = renderSuggestionsHook();
      act(() => {
        result.current.suggestionsMutation.mutate();
      });

      await waitFor(() => {
        expect(mockAddLocalMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            content: "You've reached your daily AI usage limit. Please try again later.",
          })
        );
      });
    });

    it("handles RateLimitError with retryAfter correctly", async () => {
      vi.mocked(api.timeline.getSuggestions).mockRejectedValueOnce(
        new RateLimitError("Rate limited", 30)
      );

      const { result } = renderSuggestionsHook();
      act(() => {
        result.current.suggestionsMutation.mutate();
      });

      await waitFor(() => {
        expect(mockAddLocalMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            content: "You're sending requests too quickly. Please wait about 30 seconds and try again.",
          })
        );
      });
    });

    it("handles RateLimitError without retryAfter correctly", async () => {
      vi.mocked(api.timeline.getSuggestions).mockRejectedValueOnce(
        new RateLimitError("Rate limited", null)
      );

      const { result } = renderSuggestionsHook();
      act(() => {
        result.current.suggestionsMutation.mutate();
      });

      await waitFor(() => {
        expect(mockAddLocalMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            content: "You're sending requests too quickly. Please wait a moment and try again.",
          })
        );
      });
    });

    it("handles AbortError/TimeoutError correctly", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      vi.mocked(api.timeline.getSuggestions).mockRejectedValueOnce(abortError);

      const { result } = renderSuggestionsHook();
      act(() => {
        result.current.suggestionsMutation.mutate();
      });

      await waitFor(() => {
        expect(mockAddLocalMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            content: "Suggestions are taking longer than expected. Please try again in a moment.",
          })
        );
      });
    });

    it("handles generic timeout Error correctly", async () => {
      vi.mocked(api.timeline.getSuggestions).mockRejectedValueOnce(
        new Error("The request timed out")
      );

      const { result } = renderSuggestionsHook();
      act(() => {
        result.current.suggestionsMutation.mutate();
      });

      await waitFor(() => {
        expect(mockAddLocalMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            content: "Suggestions are taking longer than expected. Please try again in a moment.",
          })
        );
      });
    });

    it("handles network Error correctly", async () => {
      vi.mocked(api.timeline.getSuggestions).mockRejectedValueOnce(
        new Error("Failed to fetch data")
      );

      const { result } = renderSuggestionsHook();
      act(() => {
        result.current.suggestionsMutation.mutate();
      });

      await waitFor(() => {
        expect(mockAddLocalMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            content: "Network error — please check your connection and try again.",
          })
        );
      });
    });

    it("handles generic Error correctly", async () => {
      vi.mocked(api.timeline.getSuggestions).mockRejectedValueOnce(
        new Error("Something went wrong")
      );

      const { result } = renderSuggestionsHook();
      act(() => {
        result.current.suggestionsMutation.mutate();
      });

      await waitFor(() => {
        expect(mockAddLocalMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            content: "Sorry, I couldn't analyze your workouts right now. Please try again.",
          })
        );
      });
    });
  });

  describe("handleApplySuggestion error handling", () => {
    it("handles error when applying suggestion fails", async () => {
      vi.mocked(api.timeline.applySuggestion).mockRejectedValueOnce(
        new Error("Failed to apply")
      );

      const mockSuggestion: Suggestion = {
        workoutId: "workout-1",
        focus: "Leg Day",
        date: "2024-01-01",
        priority: "medium",
        action: "append",
        targetField: "mainWorkout",
        recommendation: "Add squats",
        rationale: "Good for legs",
      };

      // Mock timeline with the workout
      const timeline: any = [
        { planDayId: "workout-1" }
      ];

      const { result } = renderSuggestionsHook(timeline);

      // We need to await the execution since it's an async function
      await act(async () => {
        await result.current.handleApplySuggestion(mockSuggestion);
      });

      expect(mockAddLocalMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          content: "Failed to apply suggestion to Leg Day. Please try again.",
        })
      );
    });

    it("handles error when workout is not found in timeline", async () => {
      const mockSuggestion: Suggestion = {
        workoutId: "workout-1",
        focus: "Leg Day",
        date: "2024-01-01",
        priority: "medium",
        action: "append",
        targetField: "mainWorkout",
        recommendation: "Add squats",
        rationale: "Good for legs",
      };

      // Empty timeline
      const { result } = renderSuggestionsHook([]);

      await act(async () => {
        await result.current.handleApplySuggestion(mockSuggestion);
      });

      expect(mockAddLocalMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          content: "Could not find the workout for Leg Day (2024-01-01). The suggestion is still available to retry.",
        })
      );
    });

    it("handles case where result.applied is false", async () => {
      vi.mocked(api.timeline.applySuggestion).mockResolvedValueOnce({
        applied: false,
        message: "Server rejected the suggestion",
      } as any);

      const mockSuggestion: Suggestion = {
        workoutId: "workout-1",
        focus: "Leg Day",
        date: "2024-01-01",
        priority: "medium",
        action: "append",
        targetField: "mainWorkout",
        recommendation: "Add squats",
        rationale: "Good for legs",
      };

      const timeline: any = [
        { planDayId: "workout-1" }
      ];

      const { result } = renderSuggestionsHook(timeline);

      await act(async () => {
        await result.current.handleApplySuggestion(mockSuggestion);
      });

      expect(mockAddLocalMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          content: "Server rejected the suggestion",
        })
      );
    });
  });
});
