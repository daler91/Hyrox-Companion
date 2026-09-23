import { calculateMafHr, type MafCategory } from "@shared/maf";
import { calculateNutritionTarget } from "@shared/nutritionTargets";
import type { UpsertNutritionTargetInput } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useMemo, useState } from "react";

import { parseFuellingProfile } from "@/components/onboarding/FuellingStep";
import { DEFAULT_ONBOARDING_GOAL_ID } from "@/components/onboarding/onboardingGoals";
import {
  bodyweightInput,
  changedFields,
  firstRunUnitSuggestion,
  type OnboardingProfile,
  prefersImperialUnits,
  profileFromPreferences,
} from "@/hooks/onboardingProfile";
import type { OnboardingCompletionChoice, OnboardingWizardStep } from "@/hooks/onboardingTypes";
import { useToast } from "@/hooks/use-toast";
import { useCompleteOnboarding } from "@/hooks/useCompleteOnboarding";
import { api, QUERY_KEYS, type UserPreferences } from "@/lib/api";
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

// Saved-profile fields each step writes. A step sends only the ones whose shown
// value differs from what is saved (see changedFields).
const UNITS_STEP_FIELDS = ["weightUnit", "distanceUnit", "division", "gender"] as const;
const GOAL_STEP_FIELDS = ["trainingStyleId", "mafAge", "mafCategory", "mafHrDataAvailable"] as const;

export function useOnboardingWizard(onComplete: (choice: OnboardingCompletionChoice) => void) {
  const { toast } = useToast();
  const completeOnboarding = useCompleteOnboarding();
  const [step, setStep] = useState<OnboardingWizardStep>("welcome");

  // The wizard starts from what the athlete has saved, not from hard-coded
  // defaults, and edits a draft on top of it: "Run setup again" used to show an
  // established athlete kg/km/Open/Balanced and write them back on Continue
  // (onboarding audit H2). Until the preferences arrive the defaults stand in,
  // and since only differences are ever written, a field the athlete has not
  // touched is never sent.
  const { data: savedPreferences } = useQuery<UserPreferences>({ queryKey: QUERY_KEYS.preferences });
  const saved = useMemo(() => profileFromPreferences(savedPreferences), [savedPreferences]);
  const [imperial] = useState(prefersImperialUnits);
  const [draft, setDraft] = useState<Partial<OnboardingProfile>>({});
  const shown: OnboardingProfile = {
    ...saved,
    ...firstRunUnitSuggestion(savedPreferences, imperial),
    ...draft,
  };
  const edit =
    <K extends keyof OnboardingProfile>(key: K) =>
    (value: OnboardingProfile[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));
  const {
    weightUnit,
    distanceUnit,
    division,
    gender,
    trainingStyleId,
    mafAge,
    // Maffetone's category question, answered directly (audit M6). Replaces the
    // legacy injury-boolean + consistency/trend proxies, which collapsed his -10
    // and -5 categories and granted +5 with no training-duration question.
    mafCategory,
    mafHrDataAvailable,
    heightCm,
    age,
    activityLevel,
    weightGoalDirection,
  } = shown;
  // Bodyweight is typed in the unit shown, so its saved value is formatted in
  // that unit until the athlete types over it.
  const [typedBodyweight, setTypedBodyweight] = useState<string | null>(null);
  const bodyweight = typedBodyweight ?? bodyweightInput(savedPreferences?.bodyweightKg, weightUnit);

  const [selectedGoal, setSelectedGoal] = useState<string>(DEFAULT_ONBOARDING_GOAL_ID);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date>(addDays(new Date(), 1));
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
    if (!mafAge || !mafCategory) {
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

  const buildTrainingStylePayload = (
    changes: Partial<Pick<OnboardingProfile, (typeof GOAL_STEP_FIELDS)[number]>>,
  ): Record<string, unknown> => {
    const payload: Record<string, unknown> =
      changes.trainingStyleId === undefined ? {} : { trainingStyleId };
    if (!isMafMethod) return payload;

    const age = Number(mafAge);
    payload.mafAge = age;
    payload.mafCategory = mafCategory;
    payload.mafHrDataAvailable = mafHrDataAvailable;

    const maf = calculateMafHr({ age, category: mafCategory as MafCategory });
    payload.mafHr = maf.ceiling;
    return payload;
  };

  // Saves the optional fuelling profile: with a complete, plausible profile the
  // fields are persisted and (unless declined) the computed target is set, so
  // per-meal fuel targets and the Timeline fuelling chips light up from day one.
  // An incomplete profile just skips ahead — the step is optional and Settings
  // can finish the job later. Nutrition setup never blocks onboarding.
  const handleFuellingNext = async () => {
    const parsed = parseFuellingProfile({
      bodyweight,
      heightCm,
      age,
      activityLevel,
      weightGoalDirection,
      weightUnit,
      gender,
    });
    if (!parsed) {
      setStep("plan");
      return;
    }
    // A re-run must not re-save an untouched profile, or replace targets the
    // athlete tuned by hand, just because the prefilled step was complete. So
    // "unchanged" is judged on the fields this step shows; the goal rate is not
    // one of them. Untouched bodyweight keeps its exact saved kilograms rather
    // than the rounded figure the input shows, and an unchanged lose/gain goal
    // keeps the rate set in Settings rather than the onboarding default.
    const savedRate = savedPreferences?.weightGoalRateKgPerWeek;
    const keepSavedRate =
      parsed.goalDirection !== "maintain" &&
      parsed.goalDirection === saved.weightGoalDirection &&
      savedRate != null &&
      savedRate > 0;
    const profile = {
      ...parsed,
      bodyweightKg:
        typedBodyweight === null && savedPreferences?.bodyweightKg != null
          ? savedPreferences.bodyweightKg
          : parsed.bodyweightKg,
      goalRateKgPerWeek: keepSavedRate ? savedRate : parsed.goalRateKgPerWeek,
    };
    const unchanged =
      profile.bodyweightKg === (savedPreferences?.bodyweightKg ?? null) &&
      profile.heightCm === (savedPreferences?.heightCm ?? null) &&
      profile.ageYears === (savedPreferences?.age ?? null) &&
      profile.activityLevel === (savedPreferences?.activityLevel ?? null) &&
      profile.goalDirection === (savedPreferences?.weightGoalDirection ?? null);
    if (unchanged) {
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
      const changes = changedFields(shown, saved, UNITS_STEP_FIELDS);
      try {
        if (Object.keys(changes).length > 0) await prefsMutation.mutateAsync(changes);
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
    const goalChanges = changedFields(shown, saved, GOAL_STEP_FIELDS);
    const hasGoalChanges = Object.keys(goalChanges).length > 0;
    // An untouched training style is left as saved, even a legacy MAF profile
    // this step would no longer accept as complete.
    if (hasGoalChanges && !hasValidMafProfile()) return;

    try {
      const payload = hasGoalChanges ? buildTrainingStylePayload(goalChanges) : {};
      if (Object.keys(payload).length > 0) await prefsMutation.mutateAsync(payload);
      if (FUELLING_STEP_ENABLED) {
        // The MAF profile already asked for age — don't ask twice.
        if (age === "" && mafAge !== "") edit("age")(mafAge);
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
    setWeightUnit: edit("weightUnit"),
    distanceUnit,
    setDistanceUnit: edit("distanceUnit"),
    division,
    setDivision: edit("division"),
    gender,
    setGender: edit("gender"),
    selectedGoal,
    setSelectedGoal,
    trainingStyleId,
    setTrainingStyleId: edit("trainingStyleId"),
    mafAge,
    setMafAge: edit("mafAge"),
    mafCategory,
    setMafCategory: edit("mafCategory"),
    mafHrDataAvailable,
    setMafHrDataAvailable: edit("mafHrDataAvailable"),
    startDate,
    setStartDate,
    bodyweight,
    setBodyweight: setTypedBodyweight,
    heightCm,
    setHeightCm: edit("heightCm"),
    age,
    setAge: edit("age"),
    activityLevel,
    setActivityLevel: edit("activityLevel"),
    weightGoalDirection,
    setWeightGoalDirection: edit("weightGoalDirection"),
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
