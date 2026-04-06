import type { GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";

import { api } from "@/lib/api";

import { useApiMutation } from "./useApiMutation";

export function useGeneratePlan() {
  return useApiMutation<TrainingPlanWithDays, Error, GeneratePlanInput>({
    mutationFn: (input) => api.plans.generate(input),
    invalidateQueries: [["/api/v1/plans"], ["/api/v1/timeline"]],
    successToast: "Training plan generated successfully!",
    errorToast: "Failed to generate plan",
  });
}
