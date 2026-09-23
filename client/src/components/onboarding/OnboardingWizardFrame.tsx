import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

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
  /** Called on Enter in a text field, so a step moves on as a form would. */
  readonly onEnter?: () => void;
}

const TEXT_INPUT_TYPES = new Set(["text", "number", "date", "email", "tel", "search", "url"]);

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
  onEnter,
}: OnboardingWizardFrameProps) {
  // Focus moves to the new step's heading, so it is announced. It used to
  // stay on Continue, and the new title went unread (onboarding audit M4).
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    titleRef.current?.focus();
  }, [step]);

  // No step is a <form>, so Enter in a field did nothing (audit M4). A real
  // form would also submit on the calendar's day buttons, which carry no
  // type, so the dialog handles Enter from its text fields only.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || !onEnter) return;
    const target = event.target;
    if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) {
      event.preventDefault();
      onEnter();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={(event) => event.preventDefault()}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-xl outline-none">
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
