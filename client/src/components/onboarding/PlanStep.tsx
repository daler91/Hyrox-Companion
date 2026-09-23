import type { LucideIcon } from "lucide-react";
import { FileText, Sparkles, Wand2 } from "lucide-react";

import { downloadTemplate } from "@/components/timeline/timeline-filters/csv-utils";
import { Button } from "@/components/ui/button";

interface PlanStepProps {
  /** Whether the AI Coach is on. The AI plan leads only when it is. */
  readonly aiCoachEnabled: boolean;
  readonly onUseSamplePlan: () => void;
  readonly onImportPlan: () => void;
  readonly onGeneratePlan: () => void;
  readonly onSkip: () => void;
}

interface PlanOptionProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly primary: boolean;
  readonly onClick: () => void;
  readonly testId: string;
}

// The shared Button is `whitespace-nowrap`, so the two lines of copy used to
// stay on one line each and push the dialog about 120 px past a phone's edge,
// cutting off the descriptions and the Skip link (onboarding audit H1).
// `whitespace-normal` and `min-w-0` let them wrap inside the dialog instead.
function PlanOption({ icon: Icon, title, description, primary, onClick, testId }: PlanOptionProps) {
  return (
    <Button
      variant={primary ? "default" : "outline"}
      className="h-auto w-full min-w-0 justify-start whitespace-normal py-4"
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex w-full min-w-0 items-center gap-3">
        <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-left">
          <div className="font-medium">{title}</div>
          <div
            className={
              primary
                ? "text-xs font-normal opacity-80"
                : "text-xs font-normal text-muted-foreground"
            }
          >
            {description}
          </div>
        </div>
      </div>
    </Button>
  );
}

export function PlanStep({
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
    <PlanOption
      key="ai"
      icon={Wand2}
      title={aiCoachEnabled ? "Generate AI Plan (recommended)" : "Generate AI Plan"}
      description={
        aiCoachEnabled
          ? "Three quick questions, then 1–2 minutes to build a plan around your goal"
          : "Needs the AI Coach. You'll be asked to turn it on first"
      }
      primary={aiCoachEnabled}
      onClick={onGeneratePlan}
      testId="button-onboarding-generate-plan"
    />
  );
  const templateOption = (
    <PlanOption
      key="template"
      icon={Sparkles}
      title="Use 8-Week Template"
      description="Structured program with running, strength, and functional exercises"
      primary={!aiCoachEnabled}
      onClick={onUseSamplePlan}
      testId="button-onboarding-sample-plan"
    />
  );

  return (
    <div className="space-y-3">
      {aiCoachEnabled ? [aiOption, templateOption] : [templateOption, aiOption]}

      <PlanOption
        icon={FileText}
        title="Import Your Own Plan"
        description="Upload a CSV training plan"
        primary={false}
        onClick={onImportPlan}
        testId="button-onboarding-import"
      />
      {/* The import option gave no hint of the format, so athletes without a
          file to hand cancelled the picker (onboarding audit M1). */}
      <p className="px-1 text-xs text-muted-foreground" data-testid="text-onboarding-csv-hint">
        Columns: Week, Day, Focus, Main Workout, Accessory, Notes.{" "}
        <button
          type="button"
          className="rounded underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={downloadTemplate}
          data-testid="button-onboarding-csv-template"
        >
          Download the template
        </button>
      </p>

      <Button
        variant="ghost"
        className="h-auto w-full whitespace-normal"
        onClick={onSkip}
        data-testid="button-onboarding-skip"
      >
        Skip for now — I&apos;ll log workouts manually
      </Button>
    </div>
  );
}
