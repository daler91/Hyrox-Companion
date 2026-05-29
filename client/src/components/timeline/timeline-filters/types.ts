import type { TrainingPlan } from "@shared/schema";

import type { FilterStatus } from "../types";

export interface TimelineFiltersProps {
  readonly plans: TrainingPlan[];
  readonly plansLoading: boolean;
  readonly selectedPlanId: string | null;
  readonly onPlanChange: (planId: string | null) => void;
  readonly filterStatus: FilterStatus;
  readonly onFilterChange: (status: FilterStatus) => void;
  readonly onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly isImporting: boolean;
  readonly onRenamePlan?: (planId: string, newName: string) => void;
  readonly isRenaming?: boolean;
  readonly onGoalSave?: (planId: string, goal: string | null) => void;
  readonly isUpdatingGoal?: boolean;
  /** Open the schedule-plan dialog for the given plan id. */
  readonly onScheduleClick?: (planId: string) => void;
  /** Delete the given plan (after the in-component confirmation dialog). */
  readonly onDeletePlan?: (planId: string) => void;
  readonly isDeletingPlan?: boolean;
  readonly canBulkDelete?: boolean;
  readonly bulkDeleteMode?: boolean;
  readonly onBulkDeleteModeChange?: (enabled: boolean) => void;
}

export interface PlanSelectorProps {
  readonly plansLoading: boolean;
  readonly plans: TrainingPlan[];
  readonly selectedPlanId: string | null;
  readonly onPlanChange: (planId: string | null) => void;
  readonly openRenameDialog: () => void;
}
