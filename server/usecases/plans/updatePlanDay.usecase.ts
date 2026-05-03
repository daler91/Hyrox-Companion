import { type PlanDay, type UpdatePlanDay } from "@shared/schema";

export interface PlanDayUpdater {
  updatePlanDay: (dayId: string, data: UpdatePlanDay, userId: string) => Promise<PlanDay | null | undefined>;
}

export interface UpdatePlanDayInput {
  dayId: string;
  userId: string;
  data: UpdatePlanDay;
}

export function createUpdatePlanDayUseCase(deps: PlanDayUpdater) {
  return async ({ dayId, userId, data }: UpdatePlanDayInput): Promise<PlanDay | null | undefined> => deps.updatePlanDay(dayId, data, userId);
}
