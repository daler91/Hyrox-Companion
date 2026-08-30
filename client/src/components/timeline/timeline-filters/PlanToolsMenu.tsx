import type { TrainingPlan } from "@shared/schema";
import {
  Archive,
  CalendarDays,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { downloadTemplate } from "./csv-utils";

interface SelectedPlanMenuItemsProps {
  readonly plan: TrainingPlan;
  readonly isArchived: boolean;
  readonly onRenameClick: () => void;
  readonly onGoalClick: () => void;
  /** Open the schedule-plan dialog for the given plan id. Hidden when absent. */
  readonly onScheduleClick?: (planId: string) => void;
  /** Open the archive/restore confirmation. Hidden when absent. */
  readonly onArchiveClick?: () => void;
  /** Open the delete confirmation. Hidden when absent. */
  readonly onDeleteClick?: () => void;
}

function SelectedPlanMenuItems({
  plan,
  isArchived,
  onRenameClick,
  onGoalClick,
  onScheduleClick,
  onArchiveClick,
  onDeleteClick,
}: Readonly<SelectedPlanMenuItemsProps>) {
  return (
    <>
      <DropdownMenuLabel className="text-xs">{plan.name}</DropdownMenuLabel>
      <DropdownMenuItem onClick={onRenameClick} data-testid="menuitem-rename-plan">
        <Pencil className="h-4 w-4 mr-2" />
        Rename plan
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onGoalClick} data-testid="menuitem-set-goal">
        <Target className="h-4 w-4 mr-2" />
        {plan.goal ? "Edit goal" : "Set goal"}
      </DropdownMenuItem>
      {onScheduleClick ? (
        <DropdownMenuItem
          onClick={() => onScheduleClick(plan.id)}
          data-testid="menuitem-reschedule-plan"
        >
          <CalendarDays className="h-4 w-4 mr-2" />
          Reschedule
        </DropdownMenuItem>
      ) : null}
      {onArchiveClick ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onArchiveClick();
          }}
          data-testid="menuitem-archive-plan"
        >
          <Archive className="h-4 w-4 mr-2" />
          {isArchived ? "Restore plan" : "Archive plan"}
        </DropdownMenuItem>
      ) : null}
      {onDeleteClick ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onDeleteClick();
          }}
          className="text-destructive focus:text-destructive focus:bg-destructive/10"
          data-testid="menuitem-delete-plan"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete plan
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
    </>
  );
}

interface PlanToolsMenuProps extends Omit<SelectedPlanMenuItemsProps, "plan"> {
  readonly selectedPlan: TrainingPlan | undefined;
  readonly isImporting: boolean;
  readonly canBulkDelete?: boolean;
  readonly bulkDeleteMode?: boolean;
  readonly onGenerateClick: () => void;
  readonly onImportClick: () => void;
  /** Toggle bulk-delete mode. The menu entry is hidden when absent. */
  readonly onBulkDeleteModeChange?: (enabled: boolean) => void;
}

export function PlanToolsMenu({
  selectedPlan,
  isArchived,
  isImporting,
  canBulkDelete,
  bulkDeleteMode,
  onRenameClick,
  onGoalClick,
  onGenerateClick,
  onImportClick,
  onScheduleClick,
  onArchiveClick,
  onDeleteClick,
  onBulkDeleteModeChange,
}: Readonly<PlanToolsMenuProps>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between md:w-auto"
          data-testid="button-plan-tools"
          aria-label="Plan tools"
        >
          <span className="inline-flex items-center gap-2">
            <MoreHorizontal className="h-4 w-4" />
            Plan tools
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {selectedPlan ? (
          <SelectedPlanMenuItems
            plan={selectedPlan}
            isArchived={isArchived}
            onRenameClick={onRenameClick}
            onGoalClick={onGoalClick}
            onScheduleClick={onScheduleClick}
            onArchiveClick={onArchiveClick}
            onDeleteClick={onDeleteClick}
          />
        ) : null}
        <DropdownMenuLabel className="text-xs">Plan setup</DropdownMenuLabel>
        <DropdownMenuItem onClick={onGenerateClick} data-testid="button-generate-ai-plan">
          <Sparkles className="h-4 w-4 mr-2" />
          AI plan
        </DropdownMenuItem>
        <DropdownMenuItem onClick={downloadTemplate} data-testid="button-download-template">
          <Download className="h-4 w-4 mr-2" />
          Download template
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isImporting}
          onSelect={(event) => {
            event.preventDefault();
            onImportClick();
          }}
          data-testid="button-import-plan"
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Import plan
        </DropdownMenuItem>
        {onBulkDeleteModeChange ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canBulkDelete && !bulkDeleteMode}
              onSelect={(event) => {
                event.preventDefault();
                onBulkDeleteModeChange(!bulkDeleteMode);
              }}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              data-testid="menuitem-bulk-delete-mode"
            >
              {bulkDeleteMode ? (
                <X className="h-4 w-4 mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {bulkDeleteMode ? "Exit bulk delete" : "Bulk delete"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
