import { useState } from "react";
import { useTimelineData } from "./useTimelineData";
import { useTimelineFilters } from "./useTimelineFilters";
import { useOnboarding } from "./useOnboarding";
import { usePlanImport } from "./usePlanImport";
import { useWorkoutActions } from "./useWorkoutActions";
import { useCombineWorkouts } from "./useCombineWorkouts";

export function useTimelineState() {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const data = useTimelineData(selectedPlanId);
  const filters = useTimelineFilters(data.timelineData);

  const planImport = usePlanImport({
    onPlanScheduled: (planId) => setSelectedPlanId(planId),
  });

  const onboarding = useOnboarding(data.isNewUser, planImport.fileInputRef);
  const workoutActions = useWorkoutActions(selectedPlanId);
  const combine = useCombineWorkouts();

  return {
    ...data,

    selectedPlanId,
    setSelectedPlanId,
    ...filters,

    ...onboarding,
    ...planImport,
    ...workoutActions,
    ...combine,
  };
}
