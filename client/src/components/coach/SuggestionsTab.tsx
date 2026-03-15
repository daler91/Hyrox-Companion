import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SuggestionCard, type Suggestion } from "./SuggestionCard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCurrentTimeString } from "@/lib/dateUtils";
import type { Message } from "@/hooks/useChatSession";
import type { TimelineEntry } from "@shared/schema";

interface UseSuggestionsOptions {
  timeline: TimelineEntry[];
  addLocalMessage: (message: Message) => void;
  saveMessage: (msg: { role: string; content: string }) => void;
}

export function useSuggestions({ timeline, addLocalMessage, saveMessage }: UseSuggestionsOptions) {
  const [pendingSuggestions, setPendingSuggestions] = useState<Suggestion[]>([]);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const suggestionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/timeline/ai-suggestions", {});
      return res.json();
    },
    onSuccess: (data: { suggestions: Suggestion[] }) => {
      let responseContent: string;
      if (!data.suggestions || data.suggestions.length === 0) {
        responseContent = "Your upcoming workouts look well-balanced! I don't have any specific improvements to suggest right now.";
        setPendingSuggestions([]);
      } else {
        responseContent = `I have ${data.suggestions.length} suggestion${data.suggestions.length > 1 ? 's' : ''} for your upcoming workouts. Review them below and click Apply to add them to your plan.`;
        setPendingSuggestions(data.suggestions);
      }
      
      const suggestionsMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: responseContent,
        timestamp: getCurrentTimeString(),
      };
      addLocalMessage(suggestionsMessage);
      saveMessage({ role: "assistant", content: responseContent });
    },
    onError: (error: any) => {
      let errorContent = "Sorry, I couldn't analyze your workouts right now. Please try again.";
      if (error?.message?.includes("429") || error?.status === 429) {
        errorContent = "You're sending requests too quickly. Please wait a moment and try again.";
      } else if (error?.message?.includes("network") || error?.message?.includes("fetch")) {
        errorContent = "Network error — please check your connection and try again.";
      }
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: errorContent,
        timestamp: getCurrentTimeString(),
      };
      addLocalMessage(errorMessage);
    },
  });

  const handleApplySuggestion = async (suggestion: Suggestion) => {
    setApplyingId(suggestion.workoutId);
    try {
      const workoutEntry = timeline.find(e => e.planDayId === suggestion.workoutId);
      if (!workoutEntry) {
        const errorMessage: Message = {
          id: Date.now().toString(),
          role: "assistant",
          content: `Could not find the workout for ${suggestion.focus} (${suggestion.date}). The suggestion is still available to retry.`,
          timestamp: getCurrentTimeString(),
        };
        addLocalMessage(errorMessage);
        return;
      }

      const currentValue = (workoutEntry[suggestion.targetField] as string) || "";
      let newValue: string;
      
      if (suggestion.action === "append") {
        if (currentValue.trim()) {
          newValue = `${currentValue}\n\nAI suggestion: ${suggestion.recommendation}`;
        } else {
          newValue = `AI suggestion: ${suggestion.recommendation}`;
        }
      } else {
        newValue = suggestion.recommendation;
      }

      await apiRequest("PATCH", `/api/plans/days/${suggestion.workoutId}`, {
        [suggestion.targetField]: newValue,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      if (suggestion.action === "replace" && suggestion.targetField === "mainWorkout") {
        queryClient.invalidateQueries({ queryKey: ["/api/exercise-analytics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/personal-records"] });
      }
      setPendingSuggestions(prev => prev.filter(s => s.workoutId !== suggestion.workoutId));
      
      const confirmMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `Applied suggestion to ${suggestion.focus} (${suggestion.date}). The ${suggestion.targetField === "mainWorkout" ? "main workout" : suggestion.targetField} has been updated.`,
        timestamp: getCurrentTimeString(),
      };
      addLocalMessage(confirmMessage);
    } catch {
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `Failed to apply suggestion to ${suggestion.focus}. Please try again.`,
        timestamp: getCurrentTimeString(),
      };
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
    suggestionsMutation,
    handleApplySuggestion,
    handleDismissSuggestion,
    clearSuggestions,
  };
}

interface SuggestionsListProps {
  suggestions: Suggestion[];
  applyingId: string | null;
  onApply: (suggestion: Suggestion) => void;
  onDismiss: (workoutId: string) => void;
}

export function SuggestionsList({ suggestions, applyingId, onApply, onDismiss }: SuggestionsListProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-2">
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.workoutId}
          suggestion={suggestion}
          onApply={() => onApply(suggestion)}
          onDismiss={() => onDismiss(suggestion.workoutId)}
          isApplying={applyingId === suggestion.workoutId}
        />
      ))}
    </div>
  );
}
