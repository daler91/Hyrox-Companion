import { useState } from "react";

import { GoalStep } from "@/components/onboarding/GoalStep";
import { OnboardingWizardFooter } from "@/components/onboarding/OnboardingWizardFooter";
import { OnboardingWizardFrame } from "@/components/onboarding/OnboardingWizardFrame";
import { PlanStep } from "@/components/onboarding/PlanStep";
import { ScheduleStep } from "@/components/onboarding/ScheduleStep";
import { UnitsStep } from "@/components/onboarding/UnitsStep";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { GeneratePlanDialog } from "@/components/plans/GeneratePlanDialog";
import type { OnboardingCompletionChoice, OnboardingWizardStep } from "@/hooks/onboardingTypes";
import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";

interface OnboardingWizardProps {
  readonly open: boolean;
  readonly onComplete: (choice: OnboardingCompletionChoice) => void;
}

const TITLES: Record<OnboardingWizardStep, string> = {
  welcome: "Welcome to fitai.coach",
  units: "Set Your Preferences",
  goal: "What's Your Goal?",
  plan: "Choose Your Path",
  schedule: "When Do You Start?",
};
const DESCS: Record<OnboardingWizardStep, string> = {
  welcome: "Let's get you set up in just a few steps.",
  units: "Choose your preferred measurement units.",
  goal: "This helps us tailor your experience.",
  plan: "How would you like to start training?",
  schedule: "Pick the first day of your 8-week program.",
};
const STEPS: OnboardingWizardStep[] = ["welcome", "units", "goal", "plan", "schedule"];

export function OnboardingWizard({ open, onComplete }: Readonly<OnboardingWizardProps>) {
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const {
    step,
    idx,
    total,
    weightUnit,
    setWeightUnit,
    distanceUnit,
    setDistanceUnit,
    selectedGoal,
    setSelectedGoal,
    startDate,
    setStartDate,
    handleNext,
    handleSkip,
    handleImportPlan,
    handleBack,
    handleStartTraining,
    handleUseSamplePlan,
    handleGeneratedPlan,
    isPrefsPending,
    isSamplePending,
    isSchedulePending,
  } = useOnboardingWizard(onComplete);

  // Esc closes onboarding as "skip"; backdrop clicks remain blocked in the
  // frame to avoid accidental dismissal mid-wizard.
  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleSkip();
    }
  };

  return (
    <OnboardingWizardFrame
      open={open}
      onOpenChange={handleDialogOpenChange}
      title={TITLES[step]}
      description={DESCS[step]}
      step={step}
      steps={STEPS}
      idx={idx}
      total={total}
      footer={
        <OnboardingWizardFooter
          step={step}
          onBack={handleBack}
          onNext={handleNext}
          onStartTraining={handleStartTraining}
          isPrefsPending={isPrefsPending}
          isSchedulePending={isSchedulePending}
        />
      }
    >
      {step === "welcome" && <WelcomeStep />}
      {step === "units" && (
        <UnitsStep
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          onWeightUnitChange={setWeightUnit}
          onDistanceUnitChange={setDistanceUnit}
        />
      )}
      {step === "goal" && <GoalStep selectedGoal={selectedGoal} onGoalChange={setSelectedGoal} />}
      {step === "plan" && (
        <>
          <PlanStep
            isPending={isSamplePending}
            onUseSamplePlan={handleUseSamplePlan}
            onImportPlan={handleImportPlan}
            onGeneratePlan={() => setShowGenerateDialog(true)}
            onSkip={handleSkip}
          />
          <GeneratePlanDialog
            open={showGenerateDialog}
            onOpenChange={setShowGenerateDialog}
            onGenerated={handleGeneratedPlan}
          />
        </>
      )}
      {step === "schedule" && (
        <ScheduleStep startDate={startDate} onStartDateChange={setStartDate} />
      )}
    </OnboardingWizardFrame>
  );
}
