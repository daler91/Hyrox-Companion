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
  /** The forward button's label past the Welcome step. */
  readonly nextLabel?: string;
}

export function OnboardingWizardFooter({
  step,
  onBack,
  onNext,
  onStartTraining,
  isPrefsPending,
  isSchedulePending,
  nextLabel = "Continue",
}: OnboardingWizardFooterProps) {
  // Pinned to the bottom of the scrolling dialog: on a phone the taller steps
  // pushed Continue and Start Training below the fold (onboarding audit H1).
  // The negative margins run it edge to edge over the dialog's padding.
  return (
    <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex justify-between gap-2 border-t bg-background px-6 pb-6 pt-4">
      {/* Back on the plan step too, e.g. to turn the AI Coach on after seeing
          that the AI plan needs it. */}
      {step === "welcome" ? (
        <div />
      ) : (
        <Button variant="ghost" onClick={onBack} disabled={isSchedulePending}>
          <ChevronLeft className="h-4 w-4 mr-1" aria-hidden /> Back
        </Button>
      )}
      {step === "schedule" ? (
        <Button
          onClick={onStartTraining}
          disabled={isSchedulePending}
          data-testid="button-onboarding-start-plan"
        >
          {isSchedulePending && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}
          Start Training <ChevronRight className="h-4 w-4 ml-1" aria-hidden />
        </Button>
      ) : null}
      {step !== "plan" && step !== "schedule" ? (
        <Button onClick={onNext} disabled={isPrefsPending}>
          {isPrefsPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}
          {step === "welcome" ? "Get Started" : nextLabel}{" "}
          <ChevronRight className="h-4 w-4 ml-1" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
