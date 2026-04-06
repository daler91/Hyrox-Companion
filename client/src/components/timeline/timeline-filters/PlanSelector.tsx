import { Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { PlanSelectorProps } from "./types";

export function PlanSelector({
  plansLoading,
  plans,
  selectedPlanId,
  onPlanChange,
  openRenameDialog,
}: Readonly<PlanSelectorProps>) {
  if (plansLoading) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading plans...</span>
      </div>
    );
  }

  if (plans.length > 0) {
    return (
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={openRenameDialog}
                data-testid="button-rename-plan" aria-label="Rename plan"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rename plan</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center">
      <span className="text-sm text-muted-foreground">No plans yet</span>
    </div>
  );
}
