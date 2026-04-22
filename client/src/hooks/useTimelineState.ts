import { useState } from "react";

import { useCombineWorkouts } from "./useCombineWorkouts";
import { useOnboarding } from "./useOnboarding";
import { usePlanImport } from "./usePlanImport";
import { useTimelineData } from "./useTimelineData";
import { useTimelineFilters } from "./useTimelineFilters";
import { useWorkoutActions } from "./useWorkoutActions";

export function useTimelineState(options?: { aiCoachEnabled?: boolean }) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const data = useTimelineData(selectedPlanId);
  const filters = useTimelineFilters(data.timelineData, data.annotations);

  const planImport = usePlanImport({
    onPlanScheduled: (planId) => setSelectedPlanId(planId),
  });

  const onboarding = useOnboarding(data.isNewUser, planImport.fileInputRef, options?.aiCoachEnabled);
  const workoutActions = useWorkoutActions(selectedPlanId, data.timelineData);
  const combine = useCombineWorkouts();

  return {
    data,
    filters,
    onboarding,
    planImport,
    workoutActions,
    combine,
    selectedPlanId,
    setSelectedPlanId,
  };
}
