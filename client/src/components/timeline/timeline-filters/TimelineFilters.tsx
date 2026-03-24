import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Upload, Loader2, Filter, Download, Pencil, Target } from "lucide-react";
import type { FilterStatus } from "../types";
import type { TimelineFiltersProps } from "./types";
import { downloadTemplate } from "./csv-utils";
import { PlanSelector } from "./PlanSelector";
import { RenamePlanDialog } from "./RenamePlanDialog";
import { GoalDialog } from "./GoalDialog";

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
}: Readonly<TimelineFiltersProps>) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalText, setGoalText] = useState("");

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

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <TooltipProvider delayDuration={300}>
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
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
                  className="w-full sm:w-36"
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

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={downloadTemplate}
                  data-testid="button-download-template"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Template
                </Button>

                <Label htmlFor="csv-upload" className="cursor-pointer">
                  <Button variant="outline" className="pointer-events-none" disabled={isImporting}>
                    {isImporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Import
                      </>
                    )}
                  </Button>
                </Label>
                <Input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={onFileUpload}
                  data-testid="input-csv-upload"
                />
              </div>
            </div>

            {/* Plan goal strip — shown when a specific plan is selected */}
            {selectedPlan && (
              <div className="flex items-center gap-2 pt-1 border-t mt-1">
                <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <button
                  type="button"
                  className="flex-1 text-left text-sm text-muted-foreground hover:text-foreground truncate transition-colors"
                  onClick={openGoalDialog}
                  data-testid="button-plan-goal"
                  title="Set plan goal"
                >
                  {selectedPlan.goal ? (
                    selectedPlan.goal
                  ) : (
                    <span className="italic">Add a goal, e.g. Complete Hyrox in under 90 min…</span>
                  )}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={openGoalDialog}
                      aria-label="Edit plan goal"
                      data-testid="button-edit-goal"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit plan goal</TooltipContent>
                </Tooltip>
              </div>
            )}
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
    </>
  );
}
