import { typedRequest, rawRequest } from "./client";
import type { TrainingPlan, PlanDay, GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";

export const plans = {
  list: () => typedRequest<TrainingPlan[]>("GET", "/api/v1/plans"),

  get: (id: string) => typedRequest<TrainingPlan & { days: PlanDay[] }>("GET", `/api/v1/plans/${id}`),

  import: (data: { csvContent: string; fileName?: string; planName?: string }) =>
    typedRequest<TrainingPlan>("POST", "/api/v1/plans/import", data),

  createSample: () => typedRequest<TrainingPlan>("POST", "/api/v1/plans/sample", {}),

  rename: (planId: string, name: string) =>
    rawRequest("PATCH", `/api/v1/plans/${planId}`, { name }).then(() => undefined),

  updateGoal: (planId: string, goal: string | null) =>
    typedRequest<TrainingPlan>("PATCH", `/api/v1/plans/${planId}/goal`, { goal }),

  updateDay: (planId: string, dayId: string, updates: Partial<PlanDay>) =>
    typedRequest<PlanDay>("PATCH", `/api/v1/plans/${planId}/days/${dayId}`, updates),

  updateDayWithoutPlan: (dayId: string, updates: Record<string, unknown>) =>
    typedRequest<PlanDay>("PATCH", `/api/v1/plans/days/${dayId}`, updates),

  deleteDay: (dayId: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/plans/days/${dayId}`),

  schedule: (planId: string, startDate: string) =>
    rawRequest("POST", `/api/v1/plans/${planId}/schedule`, { startDate }).then(() => undefined),

  updateDayStatus: (dayId: string, status: string) =>
    typedRequest<PlanDay>("PATCH", `/api/v1/plans/days/${dayId}/status`, { status }),

  generate: (input: GeneratePlanInput) =>
    typedRequest<TrainingPlanWithDays>("POST", "/api/v1/plans/generate", input),
} as const;
