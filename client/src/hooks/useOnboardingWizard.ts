import { useMutation } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useState } from "react";

import type { OnboardingCompletionChoice, OnboardingWizardStep } from "@/hooks/onboardingTypes";
import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { calculateMafHr } from "@shared/maf";

const STEPS: OnboardingWizardStep[] = ["welcome", "units", "goal", "plan", "schedule"];
const PREV: Partial<Record<OnboardingWizardStep, OnboardingWizardStep>> = {
  units: "welcome",
  goal: "units",
  plan: "goal",
  schedule: "plan",
};

const markComplete = () => localStorage.setItem("fitai-onboarding-complete", "true");

export function useOnboardingWizard(onComplete: (choice: OnboardingCompletionChoice) => void) {
  const { toast } = useToast();
  const [step, setStep] = useState<OnboardingWizardStep>("welcome");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">("km");
  const [selectedGoal, setSelectedGoal] = useState("first");
  const [trainingStyleId, setTrainingStyleId] = useState("balanced_default");
  const [mafAge, setMafAge] = useState("");
  const [mafInjuryIllnessMedication, setMafInjuryIllnessMedication] = useState(false);
  const [mafConsistency, setMafConsistency] = useState("");
  const [mafTrend, setMafTrend] = useState("");
  const [mafHrDataAvailable, setMafHrDataAvailable] = useState(false);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date>(addDays(new Date(), 1));

  const prefsMutation = useMutation({
    mutationFn: (prefs: Record<string, unknown>) =>
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
    onError: () => toast({ title: "Failed to create plan", variant: "destructive" }),
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
    onError: () => toast({ title: "Failed to schedule plan", variant: "destructive" }),
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
    if (step === "goal") {
      if (trainingStyleId === "maf_method" && (!mafAge || !mafConsistency || !mafTrend)) {
        toast({ title: "Complete required MAF profile fields", variant: "destructive" });
        return;
      }
      if (trainingStyleId === "maf_method") {
        const parsedMafAge = Number(mafAge);
        if (!Number.isInteger(parsedMafAge) || parsedMafAge < 16 || parsedMafAge > 99) {
          toast({
            title: "Enter a valid MAF age",
            description: "MAF age must be a whole number between 16 and 99.",
            variant: "destructive",
          });
          return;
        }
      }
      const payload: Record<string, unknown> = { trainingStyleId };
      if (trainingStyleId === "maf_method") {
        payload.mafAge = Number(mafAge);
        payload.mafInjuryIllnessMedication = mafInjuryIllnessMedication;
        payload.mafConsistency = mafConsistency;
        payload.mafTrend = mafTrend;
        payload.mafHrDataAvailable = mafHrDataAvailable;
        const maf = calculateMafHr({
          age: Number(mafAge),
          injuryIllnessMedication: mafInjuryIllnessMedication,
          consistency: mafConsistency as "low" | "moderate" | "high",
          trend: mafTrend as "improving" | "flat" | "declining",
        });
        payload.mafHr = maf.ceiling;
      }
      try {
        await prefsMutation.mutateAsync(payload);
        setStep("plan");
      } catch {
        toast({
          title: "Could not save training style",
          description: "Please try again. You can also update this later in settings.",
          variant: "destructive",
        });
      }
    }
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

  const handleGeneratedPlan = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
    markComplete();
    onComplete("generated");
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
    trainingStyleId,
    setTrainingStyleId,
    mafAge,
    setMafAge,
    mafInjuryIllnessMedication,
    setMafInjuryIllnessMedication,
    mafConsistency,
    setMafConsistency,
    mafTrend,
    setMafTrend,
    mafHrDataAvailable,
    setMafHrDataAvailable,
    startDate,
    setStartDate,
    handleNext,
    handleSkip,
    handleImportPlan,
    handleBack,
    handleStartTraining,
    handleUseSamplePlan,
    handleGeneratedPlan,
    isPrefsPending: prefsMutation.isPending,
    isSamplePending: sampleMutation.isPending,
    isSchedulePending: scheduleMutation.isPending,
  };
}
