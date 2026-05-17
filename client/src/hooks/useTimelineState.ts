import { useReducer, useRef } from "react";

import { useCombineWorkouts } from "./useCombineWorkouts";
import { useOnboarding } from "./useOnboarding";
import { usePlanImport } from "./usePlanImport";
import { useTimelineData } from "./useTimelineData";
import { useTimelineFilters } from "./useTimelineFilters";
import { useWorkoutActions } from "./useWorkoutActions";

type TimelineUiState = {
  selectedPlanId: string | null;
};

type TimelineEvent =
  | { type: "plan.selected"; planId: string | null }
  | { type: "plan.scheduled"; planId: string };

export function timelineStateReducer(
  state: TimelineUiState,
  event: TimelineEvent,
): TimelineUiState {
  switch (event.type) {
    case "plan.selected":
      return { ...state, selectedPlanId: event.planId };
    case "plan.scheduled":
      return { ...state, selectedPlanId: event.planId };
    default:
      return state;
  }
}

export function useTimelineState(options?: {
  aiCoachEnabled?: boolean;
  isAuthUserLoaded?: boolean;
  onboardingCompleted?: boolean;
}) {
  const [uiState, dispatch] = useReducer(timelineStateReducer, { selectedPlanId: null });
  const selectedPlanId = uiState.selectedPlanId;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const data = useTimelineData(selectedPlanId, options?.isAuthUserLoaded);
  const filters = useTimelineFilters(data.timelineData, data.annotations);

  const onboarding = useOnboarding(data.isNewUser, fileInputRef, {
    aiCoachEnabled: options?.aiCoachEnabled,
    isAuthUserLoaded: options?.isAuthUserLoaded,
    onboardingCompleted: options?.onboardingCompleted,
  });

  const planImport = usePlanImport({
    fileInputRef,
    onPlanImported: onboarding.handlePlanImported,
    onPlanScheduled: (planId) => dispatch({ type: "plan.scheduled", planId }),
  });

  const workoutActions = useWorkoutActions(selectedPlanId);
  const combine = useCombineWorkouts();

  return {
    data,
    filters,
    onboarding,
    planImport,
    workoutActions,
    combine,
    selectedPlanId,
    setSelectedPlanId: (planId: string | null) => dispatch({ type: "plan.selected", planId }),
  };
}
