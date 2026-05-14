import type { GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";

import { api } from "@/lib/api";

import { useApiMutation } from "./useApiMutation";

export function getGeneratePlanErrorToast(error: Error) {
  const message = error.message.toLowerCase();
  const isAiUnavailable =
    message.includes("ai_unavailable") ||
    message.includes("ai service temporarily unavailable") ||
    message.includes("timed out") ||
    message.includes("timeout");

  if (isAiUnavailable) {
    return {
      title: "AI plan generation timed out",
      description: "The AI service took too long or was temporarily unavailable. Please try again in a moment.",
    };
  }

  return {
    title: "Failed to generate plan",
    description: error.message,
  };
}

export function useGeneratePlan() {
  return useApiMutation<TrainingPlanWithDays, Error, GeneratePlanInput>({
    mutationFn: (input) => api.plans.generate(input),
    invalidateQueries: [["/api/v1/plans"], ["/api/v1/timeline"]],
    successToast: "Training plan generated successfully!",
    errorToast: getGeneratePlanErrorToast,
  });
}
