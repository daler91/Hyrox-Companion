import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import type { Message } from "@/hooks/useChatSession";
import { api, QUERY_KEYS, type RagInfo,type Suggestion } from "@/lib/api";
import { parseApiError } from "@/lib/apiError";
import { createLocalMessage } from "@/lib/chatMessage";
import { describeAiError } from "@/lib/describeAiError";
import { queryClient } from "@/lib/queryClient";

import { SuggestionCard } from "./SuggestionCard";

interface UseSuggestionsOptions {
  addLocalMessage: (message: Message) => void;
  saveMessage: (msg: { role: string; content: string }) => void;
}

/** The chat's reply when the suggestion's plan day no longer exists. */
function workoutNotFoundMessage(suggestion: Suggestion): Message {
  return createLocalMessage(
    "assistant",
    `Could not find the workout for ${suggestion.focus} (${suggestion.date}). It may have been removed from your plan.`,
  );
}

export function useSuggestions({ addLocalMessage, saveMessage }: UseSuggestionsOptions) {
  const [pendingSuggestions, setPendingSuggestions] = useState<Suggestion[]>([]);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [suggestionsRagInfo, setSuggestionsRagInfo] = useState<RagInfo | undefined>();

  const suggestionsMutation = useMutation({
    mutationFn: () => api.timeline.getSuggestions(),
    onSuccess: (data) => {
      setSuggestionsRagInfo(data.ragInfo);
      let responseContent: string;
      if (!data.suggestions || data.suggestions.length === 0) {
        // Prefer a server-provided reason (e.g. the plan-rollover nudge when a
        // plan has ended with no next one, S22) over the generic empty state.
        responseContent = data.message?.trim()
          ? data.message
          : "Your upcoming workouts look well-balanced! I don't have any specific improvements to suggest right now.";
        setPendingSuggestions([]);
      } else {
        responseContent = `I have ${data.suggestions.length} suggestion${data.suggestions.length > 1 ? 's' : ''} for your upcoming workouts. Review them below and click Apply to add them to your plan.`;
        setPendingSuggestions(data.suggestions);
      }
      
      const suggestionsMessage = createLocalMessage("assistant", responseContent);
      addLocalMessage(suggestionsMessage);
      saveMessage({ role: "assistant", content: responseContent });
    },
    onError: (error: unknown) => {
      const errorContent = describeAiError(error, {
        rateLimitActivity: "sending requests",
        slow: "Suggestions are taking longer than expected. Please try again in a moment.",
        fallback: "Sorry, I couldn't analyze your workouts right now. Please try again.",
      });
      const errorMessage = createLocalMessage("assistant", errorContent);
      addLocalMessage(errorMessage);
    },
  });

  const handleApplySuggestion = async (suggestion: Suggestion) => {
    setApplyingId(suggestion.workoutId);
    try {
      // The server looks the plan day up by id and answers 404 when it is
      // gone. The timeline this used to check first is filtered to the
      // selected plan and paged, so with another plan selected, or the day
      // on an unloaded page, every apply failed as "Could not find the
      // workout". CL36 (CODEBASE_ANALYSIS_2026-10-03)
      const result = await api.timeline.applySuggestion({
        ...suggestion,
        aiSource: suggestionsRagInfo?.source ?? null,
      });

      if (!result.applied) {
        const notAppliedMessage = createLocalMessage("assistant", result.message);
        addLocalMessage(notAppliedMessage);
        return;
      }

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planDayExercises(suggestion.workoutId) }).catch(() => {});
      if (suggestion.action === "replace" && suggestion.targetField === "mainWorkout") {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
      }
      setPendingSuggestions(prev => prev.filter(s => s.workoutId !== suggestion.workoutId));
      
      const confirmMessage = createLocalMessage(
        "assistant",
        `Applied suggestion to ${suggestion.focus} (${suggestion.date}). The ${suggestion.targetField === "mainWorkout" ? "main workout" : suggestion.targetField} has been updated.`,
      );
      addLocalMessage(confirmMessage);
    } catch (error) {
      if (parseApiError(error)?.status === 404) {
        addLocalMessage(workoutNotFoundMessage(suggestion));
        return;
      }
      const errorMessage = createLocalMessage(
        "assistant",
        `Failed to apply suggestion to ${suggestion.focus}. Please try again.`,
      );
      addLocalMessage(errorMessage);
    } finally {
      setApplyingId(null);
    }
  };

  const handleDismissSuggestion = (workoutId: string) => {
    setPendingSuggestions(prev => prev.filter(s => s.workoutId !== workoutId));
  };

  const clearSuggestions = () => {
    setPendingSuggestions([]);
  };

  return {
    pendingSuggestions,
    applyingId,
    suggestionsRagInfo,
    suggestionsMutation,
    handleApplySuggestion,
    handleDismissSuggestion,
    clearSuggestions,
  };
}

interface SuggestionsListProps {
  readonly suggestions: Suggestion[];
  readonly applyingId: string | null;
  readonly ragInfo?: RagInfo;
  readonly onApply: (suggestion: Suggestion) => void;
  readonly onDismiss: (workoutId: string) => void;
}

export function SuggestionsList({ suggestions, applyingId, ragInfo, onApply, onDismiss }: Readonly<SuggestionsListProps>) {
  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-2">
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.workoutId}
          suggestion={suggestion}
          ragInfo={ragInfo}
          onApply={() => onApply(suggestion)}
          onDismiss={() => onDismiss(suggestion.workoutId)}
          isApplying={applyingId === suggestion.workoutId}
        />
      ))}
    </div>
  );
}
