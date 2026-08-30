import type { TrainingPlan } from "@shared/schema";
import { Pencil, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PlanGoalRowProps {
  readonly plan: TrainingPlan | undefined;
  readonly onEditClick: () => void;
}

/** The goal strip under the filters. Renders nothing while no plan is selected. */
export function PlanGoalRow({ plan, onEditClick }: Readonly<PlanGoalRowProps>) {
  if (!plan) return null;

  return (
    <div className="flex items-center gap-2 pt-3 border-t mt-3">
      <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <button
        type="button"
        className="flex-1 text-left text-sm text-muted-foreground hover:text-foreground truncate transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        onClick={onEditClick}
        data-testid="button-plan-goal"
        aria-label="Edit plan goal"
      >
        {plan.goal ? plan.goal : <span className="italic">No plan goal set</span>}
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 md:h-7 md:w-7"
            onClick={onEditClick}
            aria-label="Edit plan goal"
            data-testid="button-edit-goal"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit plan goal</TooltipContent>
      </Tooltip>
    </div>
  );
}
