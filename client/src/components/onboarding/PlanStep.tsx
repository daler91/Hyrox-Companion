import { FileText, Loader2, Sparkles, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface PlanStepProps {
  readonly isPending: boolean;
  readonly onUseSamplePlan: () => void;
  readonly onImportPlan: () => void;
  readonly onGeneratePlan: () => void;
  readonly onSkip: () => void;
}

export function PlanStep({ isPending, onUseSamplePlan, onImportPlan, onGeneratePlan, onSkip }: Readonly<PlanStepProps>) {
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
            <div className="font-medium">Use 8-Week Fitness Plan (recommended)</div>
            <div className="text-xs opacity-80 font-normal">
              Structured program with running, strength, and functional exercises
            </div>
          </div>
        </div>
      </Button>

      <Button
        variant="outline"
        className="w-full justify-start h-auto py-4"
        onClick={onGeneratePlan}
        disabled={isPending}
        data-testid="button-onboarding-generate-plan"
      >
        <div className="flex items-center gap-3 w-full">
          <Wand2 className="h-5 w-5" />
          <div className="text-left flex-1">
            <div className="font-medium">Generate AI Plan</div>
            <div className="text-xs text-muted-foreground font-normal">
              AI creates a personalized periodized plan based on your goals
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
        Skip for now - I&apos;ll log workouts manually
      </Button>
    </div>
  );
}
