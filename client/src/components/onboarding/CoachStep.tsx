import { Bot, Check } from "lucide-react";

import { AiConsentDetails } from "@/components/coach/AiConsentDetails";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface CoachStepProps {
  readonly aiCoachEnabled: boolean;
  readonly onAiCoachEnabledChange: (enabled: boolean) => void;
}

const CHOICES = [
  {
    value: "on",
    label: "Turn on the AI Coach",
    description: "AI-built plans, plan adjustments as your training goes, and coach chat.",
  },
  {
    value: "off",
    label: "Not now",
    description: "Plans and logging work without it. You can turn it on later in Settings.",
  },
] as const;

/**
 * Introduces the AI Coach and asks for the consent it needs. Onboarding never
 * mentioned it before, so every new account reached the recommended AI plan
 * with the coach still off, and the server refused the plan (onboarding audit
 * C1, M6). The choice starts from the saved answer, which for a new account is
 * off. Choosing "on" shows what the coach sends before Continue records it.
 */
export function CoachStep({ aiCoachEnabled, onAiCoachEnabledChange }: Readonly<CoachStepProps>) {
  const selected = aiCoachEnabled ? "on" : "off";
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border p-3">
        <Bot className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm">
          The AI Coach builds training plans around your goal, adjusts upcoming sessions from how
          your training is going, and answers your questions in chat.
        </p>
      </div>
      <RadioGroup
        value={selected}
        onValueChange={(value) => onAiCoachEnabledChange(value === "on")}
        aria-label="AI Coach"
        className="space-y-2"
      >
        {CHOICES.map((choice) => (
          <label
            key={choice.value}
            htmlFor={`coach-choice-${choice.value}`}
            className={`flex w-full cursor-pointer items-center gap-3 rounded-md border p-3 text-left transition-colors focus-within:ring-1 focus-within:ring-ring ${
              selected === choice.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
            }`}
          >
            <RadioGroupItem
              value={choice.value}
              id={`coach-choice-${choice.value}`}
              data-testid={`radio-coach-${choice.value}`}
            />
            <div className="flex-1">
              <span className="font-medium">{choice.label}</span>
              <p className="text-xs text-muted-foreground">{choice.description}</p>
            </div>
            {selected === choice.value && (
              <Check className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
          </label>
        ))}
      </RadioGroup>
      {aiCoachEnabled && <AiConsentDetails data-testid="coach-consent-details" />}
    </div>
  );
}
