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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Upload, Loader2, Filter, Download, Pencil } from "lucide-react";
import type { TrainingPlan } from "@shared/schema";
import type { FilterStatus } from "./types";

const CSV_TEMPLATE = `Week,Day,Focus,Main Workout,Accessory,Notes
1,Monday,Running,5km easy run at conversational pace,Core work: 3x20 planks,Recovery focus
1,Wednesday,SkiErg,4x500m SkiErg with 90s rest,Upper body strength: 3x10 rows,Build endurance
1,Friday,Sled Work,Sled push 4x50m + Sled pull 4x50m,Lunges 3x12 each leg,Technique focus
1,Saturday,Hyrox Simulation,Mini simulation: 1km run + 500m SkiErg + 1km run,Stretching,Race prep
2,Monday,Running,6km tempo run with 2km warmup,Core circuit,Build speed
2,Wednesday,Rowing,5x500m row with 60s rest,Pull-ups 3x8,Power development
2,Friday,Burpees + Wall Balls,80 burpees for time + 100 wall balls,Mobility work,Station practice
2,Saturday,Long Run,10km easy pace,Foam rolling,Aerobic base`;

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "hyrox_training_template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

interface TimelineFiltersProps {
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
}

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
}: TimelineFiltersProps) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  const openRenameDialog = () => {
    if (selectedPlan) {
      setRenameName(selectedPlan.name);
      setRenameDialogOpen(true);
    }
  };

  const handleRenameSubmit = () => {
    if (selectedPlanId && renameName.trim()) {
      onRenamePlan?.(selectedPlanId, renameName.trim());
      setRenameDialogOpen(false);
    }
  };

  return (
    <>
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          {plansLoading ? (
            <div className="flex items-center gap-2 flex-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading plans...</span>
            </div>
          ) : plans.length > 0 ? (
            <div className="flex items-center gap-1 flex-1 sm:min-w-[200px]">
              <Select
                value={selectedPlanId || "__all__"}
                onValueChange={(value) => onPlanChange(value === "__all__" ? null : value)}
              >
                <SelectTrigger id="plan-select" aria-label="Select training plan" className="flex-1" data-testid="select-plan">
                  <SelectValue placeholder="All Plans" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Plans</SelectItem>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} ({plan.totalWeeks} weeks)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPlanId && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={openRenameDialog}
                  data-testid="button-rename-plan" aria-label="Rename plan"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center">
              <span className="text-sm text-muted-foreground">No plans yet</span>
            </div>
          )}

          <Select value={filterStatus} onValueChange={(v) => onFilterChange(v as FilterStatus)}>
            <SelectTrigger aria-label="Filter workouts by status" className="w-full sm:w-36" data-testid="select-filter">
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
              <Button
                variant="outline"
                className="pointer-events-none"
                disabled={isImporting}
              >
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
      </CardContent>
    </Card>

    <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Training Plan</DialogTitle>
        </DialogHeader>
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          placeholder="Plan name"
          onKeyDown={(e) => e.key === "Enter" && handleRenameSubmit()}
          data-testid="input-rename-plan"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRenameSubmit}
            disabled={!renameName.trim() || isRenaming}
            data-testid="button-rename-submit"
          >
            {isRenaming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
