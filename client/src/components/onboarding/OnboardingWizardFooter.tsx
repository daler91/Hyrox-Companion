import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OnboardingWizardStep } from "@/hooks/onboardingTypes";

interface OnboardingWizardFooterProps {
  readonly step: OnboardingWizardStep;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onStartTraining: () => void;
  readonly isPrefsPending: boolean;
  readonly isSchedulePending: boolean;
}

export function OnboardingWizardFooter({
  step,
  onBack,
  onNext,
  onStartTraining,
  isPrefsPending,
  isSchedulePending,
}: OnboardingWizardFooterProps) {
  return (
    <div className="flex justify-between pt-2">
      {step !== "welcome" && step !== "plan" ? (
        <Button variant="ghost" onClick={onBack} disabled={isSchedulePending}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      ) : (
        <div />
      )}
      {step === "schedule" ? (
        <Button
          onClick={onStartTraining}
          disabled={isSchedulePending}
          data-testid="button-onboarding-start-plan"
        >
          {isSchedulePending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Start Training <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      ) : null}
      {step !== "plan" && step !== "schedule" ? (
        <Button onClick={onNext} disabled={isPrefsPending}>
          {isPrefsPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {step === "welcome" ? "Get Started" : "Continue"}{" "}
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      ) : null}
    </div>
  );
}
