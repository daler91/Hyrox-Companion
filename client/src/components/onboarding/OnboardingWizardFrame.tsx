import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OnboardingWizardStep } from "@/hooks/onboardingTypes";

interface OnboardingWizardFrameProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly step: OnboardingWizardStep;
  readonly steps: readonly OnboardingWizardStep[];
  readonly idx: number;
  readonly total: number;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}

export function OnboardingWizardFrame({
  open,
  onOpenChange,
  title,
  description,
  step,
  steps,
  idx,
  total,
  children,
  footer,
}: OnboardingWizardFrameProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            <span className="sr-only">
              Step {idx + 1} of {total},{" "}
            </span>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="mt-2 mb-1 flex items-center justify-between">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            data-testid="text-onboarding-step-count"
          >
            Step {idx + 1} of {total}
          </span>
        </div>
        <progress
          value={idx + 1}
          max={total}
          className="sr-only"
          aria-label={`Step ${idx + 1} of ${total}`}
        />
        <div className="flex gap-1 mb-2" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={steps[i] ?? `${step}-${i}`}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= idx ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="py-4">{children}</div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}
