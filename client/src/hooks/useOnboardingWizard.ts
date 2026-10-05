import { calculateMafHr, type MafCategory } from "@shared/maf";
import {
  calculateNutritionTarget,
  carryPeriodizationForward,
  type NutritionTargetInput,
} from "@shared/nutritionTargets";
import type { NutritionTarget, UpsertNutritionTargetInput } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

import { connectDeviceToastAction } from "@/components/onboarding/connectDeviceToastAction";
import {
  type FuellingProfileFields,
  resolveFuellingProfile,
} from "@/components/onboarding/FuellingStep";
import { raceDateError } from "@/components/onboarding/GoalStep";
import {
  DEFAULT_ONBOARDING_GOAL_ID,
  describeOnboardingGoal,
} from "@/components/onboarding/onboardingGoals";
import { ignoreResult } from "@/hooks/chat/chatSessionModel";
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
import { NUTRITION_TARGET_QUERY_KEYS, useNutritionTargets } from "@/hooks/useNutrition";
import { api, QUERY_KEYS, type UserPreferences } from "@/lib/api";
import { getTodayString } from "@/lib/dateUtils";
import { featureFlags } from "@/lib/featureFlags";
import { defaultPlanStartDate } from "@/lib/planStart";
import { queryClient } from "@/lib/queryClient";
import { WORKOUT_DERIVED_NUTRITION_QUERY_KEYS } from "@/lib/workoutInvalidation";

// The fuelling step only earns its place when the nutrition module is on —
// without it there is nowhere for the computed targets to live.
const FUELLING_STEP_ENABLED = featureFlags.nutritionEnabled;

export const ONBOARDING_STEPS: OnboardingWizardStep[] = FUELLING_STEP_ENABLED
  ? ["welcome", "units", "goal", "fuelling", "coach", "plan", "schedule"]
  : ["welcome", "units", "goal", "coach", "plan", "schedule"];
const PREV: Partial<Record<OnboardingWizardStep, OnboardingWizardStep>> = FUELLING_STEP_ENABLED
  ? {
      units: "welcome",
      goal: "units",
      fuelling: "goal",
      coach: "fuelling",
      plan: "coach",
      schedule: "plan",
    }
  : { units: "welcome", goal: "units", coach: "goal", plan: "coach", schedule: "plan" };

// Saved-profile fields each step writes. A step sends only the ones whose shown
// value differs from what is saved (see changedFields).
const UNITS_STEP_FIELDS = ["weightUnit", "distanceUnit", "division", "gender", "age"] as const;
const GOAL_STEP_FIELDS = [
  "trainingStyleId",
  "mafAge",
  "mafCategory",
  "mafHrDataAvailable",
] as const;

// General age is optional; if given it must be a whole number the server
// accepts (13-100).
function validateAge(value: string): string | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 13 && parsed <= 100
    ? null
    : "Enter a whole number between 13 and 100, or leave it blank.";
}

/** Whether the resolved fuelling profile matches what is saved, field for field. */
function isSavedFuellingProfile(
  profile: NutritionTargetInput,
  saved: UserPreferences | undefined,
): boolean {
  return (
    profile.bodyweightKg === (saved?.bodyweightKg ?? null) &&
    profile.heightCm === (saved?.heightCm ?? null) &&
    profile.ageYears === (saved?.age ?? null) &&
    profile.activityLevel === (saved?.activityLevel ?? null) &&
    profile.goalDirection === (saved?.weightGoalDirection ?? null)
  );
}

/**
 * The target a fuelling-step save writes: the computed macros, with the current
 * version's periodisation carried forward. Bare macros wrote a version with
 * periodisation, recovery and phase-awareness off and every knob nulled.
 * CL20 (CODEBASE_ANALYSIS_2026-10-03)
 */
function fuellingTargetInput(
  macros: Pick<UpsertNutritionTargetInput, "calories" | "proteinG" | "carbG" | "fatG">,
  current: NutritionTarget | null,
): UpsertNutritionTargetInput {
  return current ? { ...macros, ...carryPeriodizationForward(current, macros.carbG ?? null) } : macros;
}

export function useOnboardingWizard(
  onComplete: (choice: OnboardingCompletionChoice) => void,
  /** Whether the wizard is showing. It stays mounted while hidden (see useOnboarding). */
  open: boolean,
) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const completeOnboarding = useCompleteOnboarding();
  const [step, setStep] = useState<OnboardingWizardStep>("welcome");

  const connectDeviceAction = () =>
    connectDeviceToastAction(() => navigate("/settings?tab=integrations"));

  // The wizard starts from what the athlete has saved, not from hard-coded
  // defaults, and edits a draft on top of it: "Run setup again" used to show an
  // established athlete kg/km/Open/Balanced and write them back on Continue
  // (onboarding audit H2). Until the preferences arrive the defaults stand in,
  // and since only differences are ever written, a field the athlete has not
  // touched is never sent.
  const { data: savedPreferences } = useQuery<UserPreferences>({
    queryKey: QUERY_KEYS.preferences,
  });
  const saved = useMemo(() => profileFromPreferences(savedPreferences), [savedPreferences]);
  const imperial = useMemo(() => prefersImperialUnits(), []);
  const [draft, setDraft] = useState<Partial<OnboardingProfile>>({});
  const [selectedGoal, setSelectedGoal] = useState<string>(DEFAULT_ONBOARDING_GOAL_ID);
  // "Lose weight" on the Goal step now carries into the fuelling step's weight
  // goal, which stayed on Maintain (onboarding audit M3). Only as a starting
  // value: a saved weight goal or the athlete's own pick wins.
  const goalSuggestion: Partial<OnboardingProfile> =
    selectedGoal === "weight_loss" && savedPreferences?.weightGoalDirection == null
      ? { weightGoalDirection: "lose" }
      : {};
  const shown: OnboardingProfile = {
    ...saved,
    ...firstRunUnitSuggestion(savedPreferences, imperial),
    ...goalSuggestion,
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
    aiCoachEnabled,
  } = shown;
  // Bodyweight is typed in the unit shown, so its saved value is formatted in
  // that unit until the athlete types over it.
  const [typedBodyweight, setTypedBodyweight] = useState<string | null>(null);
  const bodyweight = typedBodyweight ?? bodyweightInput(savedPreferences?.bodyweightKg, weightUnit);

  // A race the athlete has booked, as typed, "" when none. Not a preference:
  // it anchors the AI plan's end date and is kept on a template plan. One the
  // Goal step can't use (not a real day, or past) holds that step, so later
  // steps only ever see a usable date (CL9, CODEBASE_ANALYSIS_2026-10-03).
  const [raceDate, setRaceDate] = useState("");
  // The earliest race date offered: today, read again each time the Goal step
  // comes into view (from Units, Back from the next step, or the wizard
  // reopening on it) and on its Continue. The wizard stays mounted while
  // hidden, so a today read once on mount went stale overnight, and the
  // picker's `min` and the step's error used yesterday.
  // CL9 (CODEBASE_ANALYSIS_2026-10-03)
  const [minRaceDate, setMinRaceDate] = useState(getTodayString);
  const goalStepShown = open && step === "goal";
  const [wasGoalStepShown, setWasGoalStepShown] = useState(goalStepShown);
  if (goalStepShown !== wasGoalStepShown) {
    setWasGoalStepShown(goalStepShown);
    if (goalStepShown) setMinRaceDate(getTodayString());
  }
  const raceDateInputRef = useRef<HTMLInputElement>(null);
  // Inline validation, named per field; the wizard only toasted a generic
  // "Complete required MAF profile fields" (onboarding audit M4).
  const [ageError, setAgeError] = useState<string | null>(null);
  const [mafErrors, setMafErrors] = useState<{ age?: string; category?: string }>({});
  // The template plan is created on Start Training, together with its
  // schedule. Creating it when the template was picked left an unscheduled
  // copy behind every time the athlete went Back from the Schedule step and
  // chose again (onboarding audit H3). An id only survives here when the
  // create worked but the schedule failed, so a retry reuses that plan.
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  // The next Monday, not tomorrow: a Monday start keeps every week-1 session
  // on the calendar (onboarding audit C3).
  const [startDate, setStartDate] = useState<Date>(() => parseISO(defaultPlanStartDate()));
  // The athlete's own answer to "set these as my targets"; null until touched.
  const [applyTargetsChoice, setApplyTargets] = useState<boolean | null>(null);
  // The current daily target: carried forward on save, and left alone by a
  // re-run that changes nothing (CL20, CODEBASE_ANALYSIS_2026-10-03).
  const targetsQuery = useNutritionTargets(FUELLING_STEP_ENABLED);
  const currentTarget = targetsQuery.data?.current ?? null;
  // Until the targets have loaded, one may exist and must not be replaced.
  const mayHaveTarget = targetsQuery.data === undefined || currentTarget != null;

  const prefsMutation = useMutation({
    mutationFn: (prefs: Record<string, unknown>) => api.preferences.update(prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(ignoreResult);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(ignoreResult);
      // The bodyweight, height, age, sex and units saved here size session
      // fuelling, the day's meal targets and energy balance, and the training
      // load behind the chips and the Fuelling block. The training-style and
      // AI Coach saves share this mutation and change none of those reads;
      // marking them stale after those saves costs at most one refetch.
      // CL19 (CODEBASE_ANALYSIS_2026-10-03)
      for (const queryKey of WORKOUT_DERIVED_NUTRITION_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey }).catch(ignoreResult);
      }
    },
  });

  const targetMutation = useMutation({
    mutationFn: (input: UpsertNutritionTargetInput) => api.nutrition.setTarget(input),
    onSuccess: () => {
      // The day summary and Timeline chips carry the target too (CL19,
      // CODEBASE_ANALYSIS_2026-10-03).
      for (const queryKey of NUTRITION_TARGET_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey }).catch(ignoreResult);
      }
    },
  });

  const templateMutation = useMutation({
    mutationFn: async (date: string) => {
      const planId =
        createdPlanId ??
        (
          await api.plans.createSample({
            goal: describeOnboardingGoal(selectedGoal, { division, raceDate: raceDate || undefined }),
            ...(raceDate ? { raceDate } : {}),
          })
        ).id;
      setCreatedPlanId(planId);
      await api.plans.schedule(planId, date);
    },
    onSuccess: () => {
      setCreatedPlanId(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      toast({
        title: "Your training plan is ready!",
        description:
          "Workouts have been scheduled on your timeline. Connect Strava or Garmin to log them automatically.",
        action: connectDeviceAction(),
      });
      completeOnboarding();
      onComplete("sample");
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {
        // Only a refresh; the toast below already reports the failure.
      });
      toast({
        title: "Failed to set up your plan",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const isMafMethod = trainingStyleId === "maf_method";

  const hasValidMafProfile = () => {
    if (!isMafMethod) return true;
    const errors: { age?: string; category?: string } = {};
    const parsedMafAge = Number(mafAge);
    if (mafAge === "") {
      errors.age = "Enter your age for the MAF heart-rate calculation.";
    } else if (!Number.isInteger(parsedMafAge) || parsedMafAge < 16 || parsedMafAge > 99) {
      errors.age = "Enter a whole number between 16 and 99.";
    }
    if (!mafCategory) errors.category = "Choose the description that fits you best.";
    setMafErrors(errors);
    return Object.keys(errors).length === 0;
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

  // Saves the units and race-profile answers that changed. An age the server
  // would refuse keeps the athlete here; a failed save does not, since
  // Settings can change all of these later.
  const handleUnitsNext = async () => {
    const error = validateAge(age);
    setAgeError(error);
    if (error) return;
    const { age: changedAge, ...changes } = changedFields(shown, saved, UNITS_STEP_FIELDS);
    const payload: Record<string, unknown> = { ...changes };
    if (changedAge !== undefined) payload.age = changedAge.trim() === "" ? null : Number(changedAge);
    try {
      if (Object.keys(payload).length > 0) await prefsMutation.mutateAsync(payload);
    } catch {
      toast({
        title: "Could not save preferences",
        description: "You can update them later in settings.",
        variant: "destructive",
      });
    }
    setStep("goal");
  };

  // Whether the race date can be used, judged on Continue against today as it
  // is then, by the rule the Goal step shows (raceDateError): a race typed for
  // today just before midnight is past once Continue is pressed after it.
  // Refreshing today has the step name it too, and the field takes focus so a
  // keyboard or screen-reader user lands on what holds the step.
  // CL9 (CODEBASE_ANALYSIS_2026-10-03)
  const checkRaceDate = () => {
    const today = getTodayString();
    setMinRaceDate(today);
    if (raceDateError(raceDate, today) === null) return true;
    raceDateInputRef.current?.focus();
    return false;
  };

  // Saves the training style when it changed. An untouched training style is
  // left as saved, even a legacy MAF profile this step would no longer accept
  // as complete. A race date the step names as unusable keeps the athlete
  // here: a past one made every day of a template plan post-race recovery.
  // Both checks run, so every error on the step shows at once.
  // CL9 (CODEBASE_ANALYSIS_2026-10-03)
  const handleGoalNext = async () => {
    const goalChanges = changedFields(shown, saved, GOAL_STEP_FIELDS);
    const hasGoalChanges = Object.keys(goalChanges).length > 0;
    const mafValid = !hasGoalChanges || hasValidMafProfile();
    const raceDateUsable = checkRaceDate();
    if (!mafValid || !raceDateUsable) return;

    try {
      const payload = hasGoalChanges ? buildTrainingStylePayload(goalChanges) : {};
      if (Object.keys(payload).length > 0) await prefsMutation.mutateAsync(payload);
      if (FUELLING_STEP_ENABLED) {
        // The MAF profile already asked for age — don't ask twice.
        if (age === "" && mafAge !== "") edit("age")(mafAge);
        setStep("fuelling");
      } else {
        setStep("coach");
      }
    } catch {
      toast({
        title: "Could not save training style",
        description: "Please try again. You can also update this later in settings.",
        variant: "destructive",
      });
    }
  };

  // The fuelling step's profile, resolved exactly as its preview resolves it
  // (see resolveFuellingProfile), or null while incomplete.
  const fuellingFields: FuellingProfileFields = {
    bodyweight,
    heightCm,
    age,
    activityLevel,
    weightGoalDirection,
    weightUnit,
    gender,
  };
  const fuellingProfile = resolveFuellingProfile(fuellingFields, savedPreferences);
  // A re-run must not re-save an untouched profile, or replace targets the
  // athlete tuned by hand, just because the prefilled step was complete. So
  // "unchanged" is judged on the fields this step shows; the goal rate is not
  // one of them.
  const fuellingUnchanged =
    fuellingProfile != null && isSavedFuellingProfile(fuellingProfile, savedPreferences);
  // The switch starts on unless that would replace a target over an untouched
  // profile; whatever it shows is what Continue does. It used to start on and
  // then be ignored for an unchanged profile, so a checked switch set nothing
  // (CL20, CODEBASE_ANALYSIS_2026-10-03).
  const applyTargets = applyTargetsChoice ?? (!mayHaveTarget || !fuellingUnchanged);

  const saveFuellingTargets = async (profile: NutritionTargetInput) => {
    const target = calculateNutritionTarget(profile);
    // The version to carry forward must be known, not still loading.
    const current = targetsQuery.isSuccess
      ? currentTarget
      : ((await targetsQuery.refetch({ throwOnError: true })).data?.current ?? null);
    await targetMutation.mutateAsync(
      fuellingTargetInput(
        { calories: target.calories, proteinG: target.proteinG, carbG: target.carbG, fatG: target.fatG },
        current,
      ),
    );
    toast({
      title: "Daily fuelling targets set",
      description: `${target.calories} kcal · ${target.proteinG} g protein to start — adjust anytime in Nutrition.`,
    });
  };

  // Saves the optional fuelling profile: with a complete, plausible profile the
  // changed fields are persisted and (unless declined) the computed target is
  // set, so per-meal fuel targets and the Timeline fuelling chips light up from
  // day one. An incomplete profile just skips ahead — the step is optional and
  // Settings can finish the job later. Nutrition setup never blocks onboarding.
  const handleFuellingNext = async () => {
    const profile = fuellingProfile;
    if (!profile || (fuellingUnchanged && !applyTargets)) {
      setStep("coach");
      return;
    }

    try {
      if (!fuellingUnchanged) {
        await prefsMutation.mutateAsync({
          bodyweightKg: profile.bodyweightKg,
          heightCm: profile.heightCm,
          age: profile.ageYears,
          activityLevel: profile.activityLevel,
          weightGoalDirection: profile.goalDirection,
          weightGoalRateKgPerWeek: profile.goalRateKgPerWeek,
        });
      }
      if (applyTargets) await saveFuellingTargets(profile);
    } catch {
      toast({
        title: "Could not save your fuelling profile",
        description: "You can set it up later in Nutrition → Targets.",
        variant: "destructive",
      });
    }
    setStep("coach");
  };

  // Saves the AI Coach choice when it changed. A failed save keeps the
  // athlete here: moving on would let the plan step offer AI plans on the
  // strength of a consent the server never recorded.
  const handleCoachNext = async () => {
    const changes = changedFields(shown, saved, ["aiCoachEnabled"]);
    try {
      if (Object.keys(changes).length > 0) await prefsMutation.mutateAsync(changes);
      setStep("plan");
    } catch {
      toast({
        title: "Could not save your AI Coach choice",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  // Continue on each step. The plan and schedule steps have no Continue: they
  // move on through their own buttons.
  const handleNext = async () => {
    if (step === "welcome") {
      setStep("units");
      return;
    }
    if (step === "units") {
      await handleUnitsNext();
      return;
    }
    if (step === "goal") {
      await handleGoalNext();
      return;
    }
    if (step === "fuelling") {
      await handleFuellingNext();
      return;
    }
    if (step === "coach") await handleCoachNext();
  };

  // A template plan whose schedule failed is abandoned when the athlete takes
  // another way out, so it doesn't linger unscheduled in their plan list.
  const discardUnscheduledTemplate = () => {
    if (!createdPlanId) return;
    const planId = createdPlanId;
    setCreatedPlanId(null);
    api.plans
      .deletePlan(planId)
      .then(() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }))
      .catch(() => {
        // Best effort: a plan that survives stays in the list, where it can be deleted.
      });
  };

  const handleSkip = () => {
    discardUnscheduledTemplate();
    completeOnboarding();
    onComplete("skip");
    toast({
      title: "Setup finished without a plan",
      description:
        "Add one anytime from Plan tools, or run setup again from Settings → Account → Getting Started.",
      action: connectDeviceAction(),
    });
  };

  const handleImportPlan = () => {
    discardUnscheduledTemplate();
    onComplete("import");
  };

  // Esc and ✕ used to end onboarding for good in one keypress, with no word on
  // how to get back (onboarding audit H4). The wizard now confirms first (see
  // OnboardingWizard), and leaving says where "Run setup again" lives.
  const handleLeaveSetup = () => {
    discardUnscheduledTemplate();
    completeOnboarding();
    onComplete("skip");
    toast({
      title: "Setup closed",
      description: "Run it again anytime from Settings → Account → Getting Started.",
    });
  };

  const handleBack = () => {
    if (PREV[step]) {
      setStep(PREV[step]);
    }
  };

  const handleStartTraining = () => {
    templateMutation.mutate(format(startDate, "yyyy-MM-dd"));
  };

  const handleUseSamplePlan = () => {
    setStep("schedule");
  };

  const handleGeneratedPlan = () => {
    discardUnscheduledTemplate();
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
    completeOnboarding();
    onComplete("generated");
  };

  // The Schedule step is the template's own start-date screen within the Plan
  // step, so it shares that step's number. The count used to grow on reaching
  // it ("5 of 5", then "6 of 6"), moving the finish line (onboarding audit M2).
  const planIdx = ONBOARDING_STEPS.indexOf("plan");
  const idx = step === "schedule" ? planIdx : ONBOARDING_STEPS.indexOf(step);
  const total = planIdx + 1;
  // The optional fuelling step saves nothing unless the profile is complete,
  // so its button says Skip until then (audit L5).
  const fuellingComplete = fuellingProfile !== null;

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
    setTrainingStyleId: (value: string) => {
      edit("trainingStyleId")(value);
      // Age was already asked on the Units step; don't ask twice.
      if (value === "maf_method" && mafAge === "" && validateAge(age) === null && age !== "") {
        edit("mafAge")(age);
      }
    },
    mafAge,
    setMafAge: (value: string) => {
      edit("mafAge")(value);
      setMafErrors((errors) => ({ ...errors, age: undefined }));
    },
    mafCategory,
    setMafCategory: (value: string) => {
      edit("mafCategory")(value);
      setMafErrors((errors) => ({ ...errors, category: undefined }));
    },
    mafErrors,
    raceDate,
    setRaceDate,
    minRaceDate,
    raceDateInputRef,
    goalDescription: describeOnboardingGoal(selectedGoal, {
      division,
      raceDate: raceDate || undefined,
    }),
    mafHrDataAvailable,
    setMafHrDataAvailable: edit("mafHrDataAvailable"),
    startDate,
    setStartDate,
    bodyweight,
    setBodyweight: setTypedBodyweight,
    heightCm,
    setHeightCm: edit("heightCm"),
    age,
    setAge: (value: string) => {
      edit("age")(value);
      setAgeError(null);
    },
    ageError,
    activityLevel,
    setActivityLevel: edit("activityLevel"),
    weightGoalDirection,
    setWeightGoalDirection: edit("weightGoalDirection"),
    applyTargets,
    setApplyTargets,
    aiCoachEnabled,
    setAiCoachEnabled: edit("aiCoachEnabled"),
    handleNext,
    handleSkip,
    handleImportPlan,
    handleLeaveSetup,
    handleBack,
    handleStartTraining,
    handleUseSamplePlan,
    handleGeneratedPlan,
    nextLabel: step === "fuelling" && !fuellingComplete ? "Skip" : "Continue",
    isPrefsPending: prefsMutation.isPending || targetMutation.isPending,
    isSchedulePending: templateMutation.isPending,
  };
}
