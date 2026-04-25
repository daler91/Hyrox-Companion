import {
  CalendarDays,
  Download,
  Filter,
  Loader2,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

import { GeneratePlanDialog } from "@/components/plans/GeneratePlanDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { FilterStatus } from "../types";
import { downloadTemplate } from "./csv-utils";
import { GoalDialog } from "./GoalDialog";
import { PlanSelector } from "./PlanSelector";
import { RenamePlanDialog } from "./RenamePlanDialog";
import type { TimelineFiltersProps } from "./types";

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
}: Readonly<TimelineFiltersProps>) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
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

  const openImportPicker = () => {
    if (!isImporting) fileInputRef.current?.click();
  };

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <TooltipProvider delayDuration={300}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-center">
              <PlanSelector
                plansLoading={plansLoading}
                plans={plans}
                selectedPlanId={selectedPlanId}
                onPlanChange={onPlanChange}
                openRenameDialog={openRenameDialog}
              />

              <Select value={filterStatus} onValueChange={(v) => onFilterChange(v as FilterStatus)}>
                <SelectTrigger aria-label="Filter workouts by status" className="w-full" data-testid="select-filter">
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
                    <>
                      <DropdownMenuLabel className="text-xs">
                        {selectedPlan.name}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={openRenameDialog}
                        data-testid="menuitem-rename-plan"
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Rename plan
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={openGoalDialog}
                        data-testid="menuitem-set-goal"
                      >
                        <Target className="h-4 w-4 mr-2" />
                        {selectedPlan.goal ? "Edit goal" : "Set goal"}
                      </DropdownMenuItem>
                      {onScheduleClick ? (
                        <DropdownMenuItem
                          onClick={() => onScheduleClick(selectedPlan.id)}
                          data-testid="menuitem-reschedule-plan"
                        >
                          <CalendarDays className="h-4 w-4 mr-2" />
                          Reschedule
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuLabel className="text-xs">
                    Plan setup
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => setGenerateDialogOpen(true)}
                    data-testid="button-generate-ai-plan"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    AI plan
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={downloadTemplate}
                    data-testid="button-download-template"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download template
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isImporting}
                    onSelect={(event) => {
                      event.preventDefault();
                      openImportPicker();
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
                </DropdownMenuContent>
              </DropdownMenu>
              <Input
                ref={fileInputRef}
                id="csv-upload"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={onFileUpload}
                data-testid="input-csv-upload"
              />
            </div>

            {selectedPlan && (
              <div className="flex items-center gap-2 pt-3 border-t mt-3">
                <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <button
                  type="button"
                  className="flex-1 text-left text-sm text-muted-foreground hover:text-foreground truncate transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  onClick={openGoalDialog}
                  data-testid="button-plan-goal"
                  aria-label="Edit plan goal"
                >
                  {selectedPlan.goal ? selectedPlan.goal : <span className="italic">No plan goal set</span>}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 md:h-7 md:w-7"
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

      <GeneratePlanDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      />
    </>
  );
}
