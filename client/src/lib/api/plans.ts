import { apiRequest } from "@/lib/queryClient";
import type {
  ImportPlanRequest,
  UpdateTrainingPlanGoal,
  SchedulePlanRequest,
  UpdatePlanDay
} from "@shared/schema";

export async function importPlan(data: ImportPlanRequest): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/plans/import", data);
  return response.json();
}

export async function samplePlan(): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/plans/sample", {});
  return response.json();
}

export async function renamePlan(planId: string, name: string): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/plans/${planId}`, { name });
  return response.json();
}

export async function updatePlanGoal(planId: string, goal: string): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/plans/${planId}/goal`, { goal });
  return response.json();
}

export async function schedulePlan(planId: string, startDate: string): Promise<any> {
  const response = await apiRequest("POST", `/api/v1/plans/${planId}/schedule`, { startDate });
  return response.json();
}

export async function updateDayStatus(dayId: string, status: string): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/plans/days/${dayId}/status`, { status });
  return response.json();
}

export async function updateDayDetails(planId: string, dayId: string, updates: UpdatePlanDay): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/plans/${planId}/days/${dayId}`, updates);
  return response.json();
}

export async function deleteDay(dayId: string): Promise<any> {
  const response = await apiRequest("DELETE", `/api/v1/plans/days/${dayId}`);
  return response.json();
}
