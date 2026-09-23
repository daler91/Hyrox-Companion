import { FileText, Loader2, Sparkles, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface PlanStepProps {
  readonly isPending: boolean;
  /** Whether the AI Coach is on. The AI plan leads only when it is. */
  readonly aiCoachEnabled: boolean;
  readonly onUseSamplePlan: () => void;
  readonly onImportPlan: () => void;
  readonly onGeneratePlan: () => void;
  readonly onSkip: () => void;
}

export function PlanStep({
  isPending,
  aiCoachEnabled,
  onUseSamplePlan,
  onImportPlan,
  onGeneratePlan,
  onSkip,
}: Readonly<PlanStepProps>) {
  // With the AI Coach off the AI plan would stop at a consent question, so it
  // no longer claims the recommended slot: the template leads, and the AI
  // option says what it needs (onboarding audit C1).
  const aiOption = (
    <Button
      key="ai"
      variant={aiCoachEnabled ? "default" : "outline"}
      className="w-full justify-start h-auto py-4"
      onClick={onGeneratePlan}
      disabled={isPending}
      data-testid="button-onboarding-generate-plan"
    >
      <div className="flex items-center gap-3 w-full">
        <Wand2 className="h-5 w-5" aria-hidden="true" />
        <div className="text-left flex-1">
          <div className="font-medium">
            {aiCoachEnabled ? "Generate AI Plan (recommended)" : "Generate AI Plan"}
          </div>
          <div
            className={
              aiCoachEnabled
                ? "text-xs opacity-80 font-normal"
                : "text-xs text-muted-foreground font-normal"
            }
          >
            {aiCoachEnabled
              ? "Personalized plan based on your goals, schedule, and experience"
              : "Needs the AI Coach. You'll be asked to turn it on first"}
          </div>
        </div>
      </div>
    </Button>
  );

  const templateOption = (
    <Button
      key="template"
      variant={aiCoachEnabled ? "outline" : "default"}
      className="w-full justify-start h-auto py-4"
      onClick={onUseSamplePlan}
      disabled={isPending}
      data-testid="button-onboarding-sample-plan"
    >
      <div className="flex items-center gap-3 w-full">
        {isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        )}
        <div className="text-left flex-1">
          <div className="font-medium">Use 8-Week Template</div>
          <div
            className={
              aiCoachEnabled
                ? "text-xs text-muted-foreground font-normal"
                : "text-xs opacity-80 font-normal"
            }
          >
            Structured program with running, strength, and functional exercises
          </div>
        </div>
      </div>
    </Button>
  );

  return (
    <div className="space-y-3">
      {aiCoachEnabled ? [aiOption, templateOption] : [templateOption, aiOption]}

      <Button
        variant="outline"
        className="w-full justify-start h-auto py-4"
        onClick={onImportPlan}
        data-testid="button-onboarding-import"
      >
        <div className="flex items-center gap-3 w-full">
          <FileText className="h-5 w-5" aria-hidden="true" />
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
