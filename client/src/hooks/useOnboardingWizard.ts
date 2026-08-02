import { calculateMafHr } from "@shared/maf";
import {
  type ActivityLevel,
  calculateNutritionTarget,
  type WeightGoalDirection,
} from "@shared/nutritionTargets";
import type { UpsertNutritionTargetInput } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useState } from "react";

import { parseFuellingProfile } from "@/components/onboarding/FuellingStep";
import { DEFAULT_ONBOARDING_GOAL_ID } from "@/components/onboarding/onboardingGoals";
import type { OnboardingCompletionChoice, OnboardingWizardStep } from "@/hooks/onboardingTypes";
import { useToast } from "@/hooks/use-toast";
import { useCompleteOnboarding } from "@/hooks/useCompleteOnboarding";
import { api, QUERY_KEYS } from "@/lib/api";
import { featureFlags } from "@/lib/featureFlags";
import { queryClient } from "@/lib/queryClient";

// The fuelling step only earns its place when the nutrition module is on —
// without it there is nowhere for the computed targets to live.
const FUELLING_STEP_ENABLED = featureFlags.nutritionEnabled;

export const ONBOARDING_STEPS: OnboardingWizardStep[] = FUELLING_STEP_ENABLED
  ? ["welcome", "units", "goal", "fuelling", "plan", "schedule"]
  : ["welcome", "units", "goal", "plan", "schedule"];
const PREV: Partial<Record<OnboardingWizardStep, OnboardingWizardStep>> = FUELLING_STEP_ENABLED
  ? { units: "welcome", goal: "units", fuelling: "goal", plan: "fuelling", schedule: "plan" }
  : { units: "welcome", goal: "units", plan: "goal", schedule: "plan" };

export function useOnboardingWizard(onComplete: (choice: OnboardingCompletionChoice) => void) {
  const { toast } = useToast();
  const completeOnboarding = useCompleteOnboarding();
  const [step, setStep] = useState<OnboardingWizardStep>("welcome");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">("km");
  const [division, setDivision] = useState<"open" | "pro">("open");
  const [gender, setGender] = useState<"male" | "female" | "prefer_not_to_say">("prefer_not_to_say");
  const [selectedGoal, setSelectedGoal] = useState<string>(DEFAULT_ONBOARDING_GOAL_ID);
  const [trainingStyleId, setTrainingStyleId] = useState("balanced_default");
  const [mafAge, setMafAge] = useState("");
  const [mafInjuryIllnessMedication, setMafInjuryIllnessMedication] = useState(false);
  const [mafConsistency, setMafConsistency] = useState("");
  const [mafTrend, setMafTrend] = useState("");
  const [mafHrDataAvailable, setMafHrDataAvailable] = useState(false);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date>(addDays(new Date(), 1));
  // Fuelling step (optional): body profile → suggested daily nutrition targets.
  const [bodyweight, setBodyweight] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [age, setAge] = useState("");
  const [activityLevel, setActivityLevel] = useState<"" | ActivityLevel>("");
  const [weightGoalDirection, setWeightGoalDirection] = useState<WeightGoalDirection>("maintain");
  const [applyTargets, setApplyTargets] = useState(true);

  const prefsMutation = useMutation({
    mutationFn: (prefs: Record<string, unknown>) => api.preferences.update(prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
    },
  });

  const targetMutation = useMutation({
    mutationFn: (input: UpsertNutritionTargetInput) => api.nutrition.setTarget(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.nutritionTargets }).catch(() => {});
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
      completeOnboarding();
      onComplete("sample");
    },
    onError: () => toast({ title: "Failed to schedule plan", variant: "destructive" }),
  });

  const isMafMethod = trainingStyleId === "maf_method";

  const hasValidMafProfile = () => {
    if (!isMafMethod) return true;
    if (!mafAge || !mafConsistency || !mafTrend) {
      toast({ title: "Complete required MAF profile fields", variant: "destructive" });
      return false;
    }
    const parsedMafAge = Number(mafAge);
    if (!Number.isInteger(parsedMafAge) || parsedMafAge < 16 || parsedMafAge > 99) {
      toast({
        title: "Enter a valid MAF age",
        description: "MAF age must be a whole number between 16 and 99.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const buildTrainingStylePayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { trainingStyleId };
    if (!isMafMethod) return payload;

    const age = Number(mafAge);
    payload.mafAge = age;
    payload.mafInjuryIllnessMedication = mafInjuryIllnessMedication;
    payload.mafConsistency = mafConsistency;
    payload.mafTrend = mafTrend;
    payload.mafHrDataAvailable = mafHrDataAvailable;

    const maf = calculateMafHr({
      age,
      injuryIllnessMedication: mafInjuryIllnessMedication,
      consistency: mafConsistency as "low" | "moderate" | "high",
      trend: mafTrend as "improving" | "flat" | "declining",
    });
    payload.mafHr = maf.ceiling;
    return payload;
  };

  // Saves the optional fuelling profile: with a complete, plausible profile the
  // fields are persisted and (unless declined) the computed target is set, so
  // per-meal fuel targets and the Timeline fuelling chips light up from day one.
  // An incomplete profile just skips ahead — the step is optional and Settings
  // can finish the job later. Nutrition setup never blocks onboarding.
  const handleFuellingNext = async () => {
    const profile = parseFuellingProfile({
      bodyweight,
      heightCm,
      age,
      activityLevel,
      weightGoalDirection,
      weightUnit,
      gender,
    });
    if (!profile) {
      setStep("plan");
      return;
    }

    try {
      await prefsMutation.mutateAsync({
        bodyweightKg: profile.bodyweightKg,
        heightCm: profile.heightCm,
        age: profile.ageYears,
        activityLevel: profile.activityLevel,
        weightGoalDirection: profile.goalDirection,
        weightGoalRateKgPerWeek: profile.goalRateKgPerWeek,
      });
      if (applyTargets) {
        const target = calculateNutritionTarget(profile);
        await targetMutation.mutateAsync({
          calories: target.calories,
          proteinG: target.proteinG,
          carbG: target.carbG,
          fatG: target.fatG,
        });
        toast({
          title: "Daily fuelling targets set",
          description: `${target.calories} kcal · ${target.proteinG} g protein to start — adjust anytime in Nutrition.`,
        });
      }
    } catch {
      toast({
        title: "Could not save your fuelling profile",
        description: "You can set it up later in Nutrition → Targets.",
        variant: "destructive",
      });
    }
    setStep("plan");
  };

  const handleNext = async () => {
    if (step === "welcome") {
      setStep("units");
      return;
    }

    if (step === "units") {
      try {
        await prefsMutation.mutateAsync({ weightUnit, distanceUnit, division, gender });
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

    if (step === "fuelling") {
      await handleFuellingNext();
      return;
    }

    if (step !== "goal") return;
    if (!hasValidMafProfile()) return;

    try {
      await prefsMutation.mutateAsync(buildTrainingStylePayload());
      if (FUELLING_STEP_ENABLED) {
        // The MAF profile already asked for age — don't ask twice.
        if (age === "" && mafAge !== "") setAge(mafAge);
        setStep("fuelling");
      } else {
        setStep("plan");
      }
    } catch {
      toast({
        title: "Could not save training style",
        description: "Please try again. You can also update this later in settings.",
        variant: "destructive",
      });
    }
  };

  const guardUnscheduledSamplePlan = () => {
    if (!createdPlanId) return false;
    setStep("schedule");
    toast({
      title: "Set a start date to finish onboarding",
      description:
        "Your template plan has been created. Pick a start date before closing onboarding.",
    });
    return true;
  };

  const handleSkip = () => {
    if (guardUnscheduledSamplePlan()) return;
    completeOnboarding();
    onComplete("skip");
  };

  const handleImportPlan = () => {
    onComplete("import");
  };

  const handleDismissAttempt = () => {
    if (guardUnscheduledSamplePlan()) return;
    handleSkip();
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
    completeOnboarding();
    onComplete("generated");
  };

  const idx = ONBOARDING_STEPS.indexOf(step);
  // The schedule step only exists on the sample-plan path, so it is hidden from
  // the count until the athlete is actually on it (long-standing behaviour).
  const total = step === "schedule" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.length - 1;

  return {
    step,
    idx,
    total,
    weightUnit,
    setWeightUnit,
    distanceUnit,
    setDistanceUnit,
    division,
    setDivision,
    gender,
    setGender,
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
    bodyweight,
    setBodyweight,
    heightCm,
    setHeightCm,
    age,
    setAge,
    activityLevel,
    setActivityLevel,
    weightGoalDirection,
    setWeightGoalDirection,
    applyTargets,
    setApplyTargets,
    handleNext,
    handleSkip,
    handleImportPlan,
    handleDismissAttempt,
    handleBack,
    handleStartTraining,
    handleUseSamplePlan,
    handleGeneratedPlan,
    isPrefsPending: prefsMutation.isPending || targetMutation.isPending,
    isSamplePending: sampleMutation.isPending,
    isSchedulePending: scheduleMutation.isPending,
  };
}
