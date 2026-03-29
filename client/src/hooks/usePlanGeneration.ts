import { useApiMutation } from "./useApiMutation";
import { api } from "@/lib/api";
import type { GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";

export function useGeneratePlan() {
  return useApiMutation<TrainingPlanWithDays, Error, GeneratePlanInput>({
    mutationFn: (input) => api.plans.generate(input),
    invalidateQueries: [["/api/v1/plans"], ["/api/v1/timeline"]],
    successToast: "Training plan generated successfully!",
    errorToast: "Failed to generate plan",
  });
}
