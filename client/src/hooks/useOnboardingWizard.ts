import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Step = "welcome" | "units" | "goal" | "plan" | "schedule";

const STEPS: Step[] = ["welcome", "units", "goal", "plan", "schedule"];
const PREV: Partial<Record<Step, Step>> = {
  units: "welcome",
  goal: "units",
  plan: "goal",
  schedule: "plan",
};

const markComplete = () =>
  localStorage.setItem("hyrox-onboarding-complete", "true");

export function useOnboardingWizard(onComplete: (choice: "sample" | "import" | "skip") => void) {
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

  const handleBack = () => {
    if (PREV[step]) {
      setStep(PREV[step]);
    }
  };

  const handleStartTraining = () => {
    if (createdPlanId) {
      scheduleMutation.mutate({
        planId: createdPlanId,
        date: format(startDate, "yyyy-MM-dd"),
      });
    }
  };

  const handleUseSamplePlan = () => {
    sampleMutation.mutate();
  };

  const idx = STEPS.indexOf(step);
  const total = step === "schedule" ? 5 : 4;

  return {
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
    isPrefsPending: prefsMutation.isPending,
    isSamplePending: sampleMutation.isPending,
    isSchedulePending: scheduleMutation.isPending,
  };
}
