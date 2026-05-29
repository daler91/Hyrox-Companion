import type { TrainingPlanWithDays } from "@shared/schema";
import { Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGeneratePlan } from "@/hooks/usePlanGeneration";

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
}

function getDescription(step: number, mode: GeneratePlanDialogProps["mode"], isGenerating: boolean): string {
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
}: GeneratePlanDialogProps) {
  const form = useGeneratePlanForm({
    initialGoal,
    initialStartDate,
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
          <DialogDescription>{getDescription(form.step, mode, generatePlan.isPending)}</DialogDescription>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
