import type { TrainingPlan, TrainingPlanWithDays } from "@shared/schema";
import { Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useIsAiCoachEnabled } from "@/hooks/useAuth";
import { useEnableAiCoach } from "@/hooks/useEnableAiCoach";
import { useGeneratePlan } from "@/hooks/usePlanGeneration";
import { cn } from "@/lib/utils";

import { GeneratePlanConsentStep } from "./generate-plan/GeneratePlanConsentStep";
import { GeneratePlanDetailsStep } from "./generate-plan/GeneratePlanDetailsStep";
import { GeneratePlanGoalStep } from "./generate-plan/GeneratePlanGoalStep";
import { GeneratePlanScheduleStep } from "./generate-plan/GeneratePlanScheduleStep";
import { buildGeneratePlanInput, useGeneratePlanForm } from "./generate-plan/useGeneratePlanForm";

interface GeneratePlanDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onGenerated?: (plan: TrainingPlanWithDays) => void;
  readonly mode?: "default" | "onboarding";
  readonly initialGoal?: string;
  readonly initialStartDate?: string;
  /**
   * The athlete's existing plans, so the schedule step can offer to archive one
   * this plan would overlap. Onboarding passes them too: "Run setup again" is
   * where an established athlete goes to switch plans.
   */
  readonly existingPlans?: readonly TrainingPlan[];
  /**
   * The caller already knows the AI Coach is on (onboarding saves the choice a
   * step earlier), so the consent step is skipped before the auth user refetch
   * catches up.
   */
  readonly aiCoachEnabled?: boolean;
}

const STEP_LABELS = ["Goal", "Schedule", "Details"] as const;

function getDescription(
  step: number,
  mode: GeneratePlanDialogProps["mode"],
  isGenerating: boolean,
): string {
  if (isGenerating) return "Generating your plan — this takes 1–2 minutes…";
  if (step === 0) return "What's your training goal?";
  if (step === 1 && mode === "onboarding") {
    return "Set your plan dates, schedule, and experience level.";
  }
  if (step === 1) return "Set your plan dates and experience level.";
  return "Optional: focus areas and additional details.";
}

export function GeneratePlanDialog({
  open,
  onOpenChange,
  onGenerated,
  mode = "default",
  initialGoal,
  initialStartDate,
  existingPlans,
  aiCoachEnabled = false,
}: GeneratePlanDialogProps) {
  // The athlete's remembered injuries/limitations, so the box arrives prefilled.
  const { user } = useAuth();
  const { toast } = useToast();
  // Generation is consent-gated on the server, and every account starts with
  // the AI Coach off, so a new athlete's first attempt used to end in a 403
  // after filling in all three steps (onboarding audit C1). Ask first, in the
  // dialog itself, so every way in (onboarding, the empty Timeline, the plan
  // menu) gets the same gate.
  const aiCoachOn = useIsAiCoachEnabled();
  const enableAiCoach = useEnableAiCoach();
  const needsConsent = !(aiCoachOn || aiCoachEnabled || enableAiCoach.isSuccess);
  const form = useGeneratePlanForm({
    initialConstraints: user?.trainingConstraints ?? "",
    initialGoal,
    initialStartDate,
    existingPlans,
  });
  const generatePlan = useGeneratePlan();

  const handleOpenChange = (nextOpen: boolean) => {
    if (generatePlan.isPending) return; // prevent closing while generating
    onOpenChange(nextOpen);
    if (!nextOpen) {
      form.resetForm();
      generatePlan.reset();
    }
  };

  const handleEnableAiCoach = () => {
    enableAiCoach.mutate(undefined, {
      onError: () =>
        toast({
          title: "Could not enable AI features",
          description: "Please try again.",
          variant: "destructive",
        }),
    });
  };

  const handleGenerate = () => {
    generatePlan.mutate(buildGeneratePlanInput(form.values), {
      onSuccess: (plan) => {
        onGenerated?.(plan);
        onOpenChange(false);
        form.resetForm();
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generate AI Training Plan
          </DialogTitle>
          <DialogDescription>
            {needsConsent
              ? "AI plans are written by the AI Coach. Turn it on to generate one."
              : getDescription(form.step, mode, generatePlan.isPending)}
          </DialogDescription>
        </DialogHeader>

        {needsConsent ? (
          <GeneratePlanConsentStep
            onEnable={handleEnableAiCoach}
            onCancel={() => handleOpenChange(false)}
            isEnabling={enableAiCoach.isPending}
          />
        ) : (
          <>
            {/* The dots are purely decorative; the sr-only span below is the sole
                announcement, so the wrapper needs no group role (which would have
                screen readers read the same step twice). */}
            <div className="flex items-center justify-center gap-1.5">
              {STEP_LABELS.map((label, i) => (
                <div
                  key={label}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === form.step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/25",
                    i < form.step && "bg-primary/50",
                  )}
                  aria-hidden="true"
                />
              ))}
              <span className="sr-only">
                Step {form.step + 1} of 3: {STEP_LABELS[form.step]}
              </span>
            </div>

            {form.step === 0 && (
              <GeneratePlanGoalStep
                goal={form.goal}
                onGoalChange={form.setGoal}
                onNext={() => form.setStep(1)}
                canProceed={form.canProceedStep0}
              />
            )}

            {form.step === 1 && (
              <GeneratePlanScheduleStep
                daysPerWeek={form.daysPerWeek}
                onDaysPerWeekChange={form.handleDaysPerWeekChange}
                restDays={form.restDays}
                requiredRestDays={form.requiredRestDays}
                onRestDayToggle={form.toggleRestDay}
                experienceLevel={form.experienceLevel}
                onExperienceLevelChange={form.setExperienceLevel}
                startDate={form.startDate}
                onStartDateChange={form.setStartDate}
                endDate={form.endDate}
                onEndDateChange={form.setEndDate}
                endDateIsRaceDate={form.endDateIsRaceDate}
                onEndDateIsRaceDateChange={form.setEndDateIsRaceDate}
                planWeeks={form.planWeeks}
                dateError={form.dateError}
                overlappingPlans={form.overlappingPlans}
                supersedePlanIds={form.supersedePlanIds}
                onToggleSupersede={form.toggleSupersede}
                onBack={() => form.setStep(0)}
                onNext={() => form.setStep(2)}
                canProceed={form.canProceedStep1}
              />
            )}

            {form.step === 2 && (
              <GeneratePlanDetailsStep
                focusAreas={form.focusAreas}
                onFocusToggle={form.toggleFocus}
                injuries={form.injuries}
                onInjuriesChange={form.setInjuries}
                onBack={() => form.setStep(1)}
                onGenerate={handleGenerate}
                canGenerate={form.canGenerate}
                isGenerating={generatePlan.isPending}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
