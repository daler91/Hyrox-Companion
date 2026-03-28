import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, ChevronLeft } from "lucide-react";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { UnitsStep } from "@/components/onboarding/UnitsStep";
import { GoalStep } from "@/components/onboarding/GoalStep";
import { PlanStep } from "@/components/onboarding/PlanStep";
import { ScheduleStep } from "@/components/onboarding/ScheduleStep";
import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";

interface OnboardingWizardProps {
  readonly open: boolean;
  readonly onComplete: (choice: "sample" | "import" | "skip") => void;
}

type Step = "welcome" | "units" | "goal" | "plan" | "schedule";

const TITLES: Record<Step, string> = {
  welcome: "Welcome to fitai.coach",
  units: "Set Your Preferences",
  goal: "What's Your Goal?",
  plan: "Choose Your Path",
  schedule: "When Do You Start?",
};
const DESCS: Record<Step, string> = {
  welcome: "Let's get you set up in just a few steps.",
  units: "Choose your preferred measurement units.",
  goal: "This helps us tailor your experience.",
  plan: "How would you like to start training?",
  schedule: "Pick the first day of your 8-week program.",
};
const STEPS: Step[] = ["welcome", "units", "goal", "plan", "schedule"];

export function OnboardingWizard({ open, onComplete }: Readonly<OnboardingWizardProps>) {
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
    isPrefsPending,
    isSamplePending,
    isSchedulePending,
  } = useOnboardingWizard(onComplete);

  const renderNextButton = () => {
    if (step === "schedule") {
      return (
        <Button
          onClick={handleStartTraining}
          disabled={isSchedulePending}
          data-testid="button-onboarding-start-plan"
        >
          {isSchedulePending && (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          )}
          Start Training <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      );
    }

    if (step !== "plan") {
      return (
        <Button onClick={handleNext} disabled={isPrefsPending}>
          {isPrefsPending && (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          )}
          {step === "welcome" ? "Get Started" : "Continue"}{" "}
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{TITLES[step]}</DialogTitle>
          <DialogDescription>{DESCS[step]}</DialogDescription>
        </DialogHeader>

        <progress
          value={idx + 1}
          max={total}
          className="sr-only"
          aria-label={`Step ${idx + 1} of ${total}`}
        />
        <div className="flex gap-1 my-2" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={STEPS[i]}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= idx ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        <div className="py-4">
          {step === "welcome" && <WelcomeStep />}
          {step === "units" && (
            <UnitsStep
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
              onWeightUnitChange={setWeightUnit}
              onDistanceUnitChange={setDistanceUnit}
            />
          )}
          {step === "goal" && (
            <GoalStep
              selectedGoal={selectedGoal}
              onGoalChange={setSelectedGoal}
            />
          )}
          {step === "plan" && (
            <PlanStep
              isPending={isSamplePending}
              onUseSamplePlan={handleUseSamplePlan}
              onImportPlan={handleImportPlan}
              onSkip={handleSkip}
            />
          )}
          {step === "schedule" && (
            <ScheduleStep
              startDate={startDate}
              onStartDateChange={setStartDate}
            />
          )}
        </div>

        <div className="flex justify-between pt-2">
          {step !== "welcome" && step !== "plan" ? (
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={isSchedulePending}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          ) : (
            <div />
          )}
          {renderNextButton()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
