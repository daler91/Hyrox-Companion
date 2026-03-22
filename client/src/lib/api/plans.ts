import { apiRequest } from "@/lib/queryClient";
import type {
  ImportPlanRequest,
  PlanDay
} from "@shared/schema";

export async function importPlan(data: ImportPlanRequest): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/plans/import", data);
  return response.json();
}

export async function samplePlan(): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/plans/sample", {});
  return response.json();
}

export async function renamePlan(planId: string | number, name: string): Promise<void> {
  await apiRequest("PATCH", `/api/v1/plans/${planId}`, { name });
}

export async function updatePlanGoal(planId: string | number, goal: string | null): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/plans/${planId}/goal`, { goal });
  return response.json();
}

export async function schedulePlan(planId: string | number, startDate: string): Promise<any> {
  const response = await apiRequest("POST", `/api/v1/plans/${planId}/schedule`, { startDate });
  // schedule plan can return success message and sometimes the hook parses it
  return response.json().catch(() => ({}));
}

export async function updateDayStatus(dayId: string | number, status: string): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/plans/days/${dayId}/status`, { status });
  return response.json();
}

export async function updateDayDetails(planId: string | number | null, dayId: string | number, updates: Partial<PlanDay>): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/plans/${planId}/days/${dayId}`, updates);
  return response.json();
}

export async function deleteDay(dayId: string | number): Promise<void> {
  await apiRequest("DELETE", `/api/v1/plans/days/${dayId}`);
}
