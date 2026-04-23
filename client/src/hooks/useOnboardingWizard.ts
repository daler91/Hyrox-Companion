import { useMutation } from "@tanstack/react-query";
import { addDays,format } from "date-fns";
import { useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type Step = "welcome" | "units" | "goal" | "plan" | "schedule";

const STEPS: Step[] = ["welcome", "units", "goal", "plan", "schedule"];
const PREV: Partial<Record<Step, Step>> = {
  units: "welcome",
  goal: "units",
  plan: "goal",
  schedule: "plan",
};

const markComplete = () =>
  localStorage.setItem("fitai-onboarding-complete", "true");

export function useOnboardingWizard(onComplete: (choice: "sample" | "import" | "skip") => void) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("welcome");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">("km");
  const [selectedGoal, setSelectedGoal] = useState("first");
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date>(addDays(new Date(), 1));

  const prefsMutation = useMutation({
    mutationFn: (prefs: { weightUnit: string; distanceUnit: string }) =>
      api.preferences.update(prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
    },
  });

  const sampleMutation = useMutation({
    mutationFn: () => api.plans.createSample(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
      setCreatedPlanId(data.id);
      setStep("schedule");
    },
    onError: () =>
      toast({ title: "Failed to create plan", variant: "destructive" }),
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ planId, date }: { planId: string; date: string }) =>
      api.plans.schedule(planId, date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
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
