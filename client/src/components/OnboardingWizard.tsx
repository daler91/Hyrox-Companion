import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronRight, ChevronLeft } from "lucide-react";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { UnitsStep } from "@/components/onboarding/UnitsStep";
import { GoalStep } from "@/components/onboarding/GoalStep";
import { PlanStep } from "@/components/onboarding/PlanStep";
import { ScheduleStep } from "@/components/onboarding/ScheduleStep";

interface OnboardingWizardProps {
  readonly open: boolean;
  readonly onComplete: (choice: "sample" | "import" | "skip") => void;
}

type Step = "welcome" | "units" | "goal" | "plan" | "schedule";

const TITLES: Record<Step, string> = {
  welcome: "Welcome to HyroxTracker",
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
const PREV: Partial<Record<Step, Step>> = {
  units: "welcome",
  goal: "units",
  plan: "goal",
  schedule: "plan",
};

const markComplete = () =>
  localStorage.setItem("hyrox-onboarding-complete", "true");

export function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("welcome");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">("km");
  const [selectedGoal, setSelectedGoal] = useState("first");
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date>(addDays(new Date(), 1));

  const prefsMutation = useMutation({
    mutationFn: async (prefs: { weightUnit: string; distanceUnit: string }) =>
      (await apiRequest("PATCH", "/api/v1/preferences", prefs)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/preferences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/user"] });
    },
  });

  const sampleMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/v1/plans/sample", {})).json(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      setCreatedPlanId(data.id);
      setStep("schedule");
    },
    onError: () =>
      toast({ title: "Failed to create plan", variant: "destructive" }),
  });

  const scheduleMutation = useMutation({
    mutationFn: async ({ planId, date }: { planId: string; date: string }) =>
      (
        await apiRequest("POST", `/api/v1/plans/${planId}/schedule`, {
          startDate: date,
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      toast({
        title: "Your training plan is ready!",
        description: "Workouts have been scheduled on your timeline.",
      });
      markComplete();
      onComplete("sample");
    },
    onError: () =>
      toast({ title: "Failed to schedule plan", variant: "destructive" }),
  });

  const handleNext = async () => {
    if (step === "welcome") {
      setStep("units");
      return;
    }
    if (step === "units") {
      try {
        await prefsMutation.mutateAsync({ weightUnit, distanceUnit });
      } catch {
        toast({
          title: "Could not save preferences",
          description: "You can update them later in settings.",
          variant: "destructive",
        });
      }
      setStep("goal");
      return;
    }
    if (step === "goal") setStep("plan");
  };

  const handleSkip = () => {
    markComplete();
    onComplete("skip");
  };

  const handleImportPlan = () => {
    markComplete();
    onComplete("import");
  };

  const idx = STEPS.indexOf(step);
  const total = step === "schedule" ? 5 : 4;

  const renderNextButton = () => {
    if (step === "schedule") {
      return (
        <Button
          onClick={() =>
            createdPlanId &&
            scheduleMutation.mutate({
              planId: createdPlanId,
              date: format(startDate, "yyyy-MM-dd"),
            })
          }
          disabled={scheduleMutation.isPending}
          data-testid="button-onboarding-start-plan"
        >
          {scheduleMutation.isPending && (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          )}
          Start Training <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      );
    }

    if (step !== "plan") {
      return (
        <Button onClick={handleNext} disabled={prefsMutation.isPending}>
          {prefsMutation.isPending && (
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
              isPending={sampleMutation.isPending}
              onUseSamplePlan={() => sampleMutation.mutate()}
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
              onClick={() => PREV[step] && setStep(PREV[step])}
              disabled={scheduleMutation.isPending}
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
