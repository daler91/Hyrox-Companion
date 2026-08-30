import { Filter } from "lucide-react";
import { useRef, useState } from "react";

import { GeneratePlanDialog } from "@/components/plans/GeneratePlanDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getTodayString } from "@/lib/dateUtils";

import { ConfirmDialog } from "../ConfirmDialog";
import type { FilterStatus } from "../types";
import { GoalDialog } from "./GoalDialog";
import { PlanGoalRow } from "./PlanGoalRow";
import { PlanSelector } from "./PlanSelector";
import { PlanToolsMenu } from "./PlanToolsMenu";
import { RenamePlanDialog } from "./RenamePlanDialog";
import type { TimelineFiltersProps } from "./types";

const ARCHIVE_DIALOG_COPY = {
  title: "Archive this plan?",
  description:
    "Its remaining sessions stop counting towards your adherence from today, and drop off the all-plans timeline. Everything you have already logged is kept.",
  confirmText: "Archive",
} as const;

const RESTORE_DIALOG_COPY = {
  title: "Restore this plan?",
  description:
    "Its past sessions will count towards your adherence again, and any that have already gone by will be marked missed.",
  confirmText: "Restore",
} as const;

export default function TimelineFilters({
  plans,
  plansLoading,
  selectedPlanId,
  onPlanChange,
  filterStatus,
  onFilterChange,
  onFileUpload,
  isImporting,
  onRenamePlan,
  isRenaming,
  onGoalSave,
  isUpdatingGoal,
  onScheduleClick,
  onDeletePlan,
  isDeletingPlan,
  onSetPlanRetirement,
  isUpdatingRetirement,
  canBulkDelete,
  bulkDeleteMode,
  onBulkDeleteModeChange,
}: Readonly<TimelineFiltersProps>) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [retirementConfirmOpen, setRetirementConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  const openRenameDialog = () => {
    if (selectedPlan) {
      setRenameName(selectedPlan.name);
      setRenameDialogOpen(true);
    }
  };

  const openGoalDialog = () => {
    if (selectedPlan) {
      setGoalText(selectedPlan.goal ?? "");
      setGoalDialogOpen(true);
    }
  };

  const handleRenameSubmit = () => {
    if (selectedPlanId && renameName.trim()) {
      onRenamePlan?.(selectedPlanId, renameName.trim());
      setRenameDialogOpen(false);
    }
  };

  const handleGoalSubmit = () => {
    if (selectedPlanId) {
      onGoalSave?.(selectedPlanId, goalText.trim() || null);
      setGoalDialogOpen(false);
    }
  };

  const isArchived = selectedPlan?.retiredOn != null;
  const retirementDialogCopy = isArchived ? RESTORE_DIALOG_COPY : ARCHIVE_DIALOG_COPY;

  const handleRetirementConfirm = () => {
    if (selectedPlanId) {
      // Archiving sends today; the server clamps it to the athlete's own
      // calendar date anyway, so the exact value here is a floor, not a promise.
      onSetPlanRetirement?.(selectedPlanId, isArchived ? null : getTodayString());
      setRetirementConfirmOpen(false);
    }
  };

  const handleDeleteConfirm = () => {
    if (selectedPlanId) {
      onDeletePlan?.(selectedPlanId);
      setDeleteConfirmOpen(false);
    }
  };

  const openImportPicker = () => {
    if (!isImporting) fileInputRef.current?.click();
  };

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <TooltipProvider>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-center">
              <PlanSelector
                plansLoading={plansLoading}
                plans={plans}
                selectedPlanId={selectedPlanId}
                onPlanChange={onPlanChange}
                openRenameDialog={openRenameDialog}
              />

              <Select value={filterStatus} onValueChange={(v) => onFilterChange(v as FilterStatus)}>
                <SelectTrigger
                  aria-label="Filter workouts by status"
                  className="w-full"
                  data-testid="select-filter"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="missed">Missed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>

              <PlanToolsMenu
                selectedPlan={selectedPlan}
                isArchived={isArchived}
                isImporting={isImporting}
                canBulkDelete={canBulkDelete}
                bulkDeleteMode={bulkDeleteMode}
                onRenameClick={openRenameDialog}
                onGoalClick={openGoalDialog}
                onGenerateClick={() => setGenerateDialogOpen(true)}
                onImportClick={openImportPicker}
                onScheduleClick={onScheduleClick}
                onArchiveClick={
                  onSetPlanRetirement ? () => setRetirementConfirmOpen(true) : undefined
                }
                onDeleteClick={onDeletePlan ? () => setDeleteConfirmOpen(true) : undefined}
                onBulkDeleteModeChange={onBulkDeleteModeChange}
              />
              <Input
                ref={fileInputRef}
                id="csv-upload"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={onFileUpload}
                aria-label="Import CSV training plan"
                data-testid="input-csv-upload"
              />
            </div>

            <PlanGoalRow plan={selectedPlan} onEditClick={openGoalDialog} />
          </TooltipProvider>
        </CardContent>
      </Card>

      <RenamePlanDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        renameName={renameName}
        setRenameName={setRenameName}
        onSubmit={handleRenameSubmit}
        isRenaming={isRenaming}
      />

      <GoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        goalText={goalText}
        setGoalText={setGoalText}
        onSubmit={handleGoalSubmit}
        isUpdatingGoal={isUpdatingGoal}
      />

      <GeneratePlanDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        existingPlans={plans}
      />

      <ConfirmDialog
        open={retirementConfirmOpen}
        onOpenChange={setRetirementConfirmOpen}
        title={retirementDialogCopy.title}
        description={retirementDialogCopy.description}
        confirmText={retirementDialogCopy.confirmText}
        cancelText="Cancel"
        onConfirm={handleRetirementConfirm}
        isPending={isUpdatingRetirement}
        cancelTestId="button-cancel-archive-plan"
        confirmTestId="button-confirm-archive-plan"
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete training plan?"
        description="This permanently deletes this plan and all of its workout days. This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
        isPending={isDeletingPlan}
        isDestructive
        cancelTestId="button-cancel-delete-plan"
        confirmTestId="button-confirm-delete-plan"
      />
    </>
  );
}
