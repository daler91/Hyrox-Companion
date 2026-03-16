import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, FileText } from "lucide-react";

interface PlanStepProps {
  isPending: boolean;
  onUseSamplePlan: () => void;
  onImportPlan: () => void;
  onSkip: () => void;
}

export function PlanStep({ isPending, onUseSamplePlan, onImportPlan, onSkip }: Readonly<PlanStepProps>) {
  return (
    <div className="space-y-3">
      <Button
        className="w-full justify-start h-auto py-4"
        onClick={onUseSamplePlan}
        disabled={isPending}
        data-testid="button-onboarding-sample-plan"
      >
        <div className="flex items-center gap-3 w-full">
          {isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
          <div className="text-left flex-1">
            <div className="font-medium">Use 8-Week Hyrox Plan</div>
            <div className="text-xs opacity-80 font-normal">
              Recommended - structured program for all levels
            </div>
          </div>
        </div>
      </Button>

      <Button
        variant="outline"
        className="w-full justify-start h-auto py-4"
        onClick={onImportPlan}
        data-testid="button-onboarding-import"
      >
        <div className="flex items-center gap-3 w-full">
          <FileText className="h-5 w-5" />
          <div className="text-left flex-1">
            <div className="font-medium">Import Your Own Plan</div>
            <div className="text-xs text-muted-foreground font-normal">
              Upload a CSV training plan
            </div>
          </div>
        </div>
      </Button>

      <Button
        variant="ghost"
        className="w-full"
        onClick={onSkip}
        data-testid="button-onboarding-skip"
      >
        Skip for now - I'll log workouts manually
      </Button>
    </div>
  );
}
