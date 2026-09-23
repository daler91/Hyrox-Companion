import type { TrainingPlan } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";

import { CoachStep } from "@/components/onboarding/CoachStep";
import { FuellingStep } from "@/components/onboarding/FuellingStep";
import { GoalStep } from "@/components/onboarding/GoalStep";
import { LeaveSetupDialog } from "@/components/onboarding/LeaveSetupDialog";
import { OnboardingWizardFooter } from "@/components/onboarding/OnboardingWizardFooter";
import { OnboardingWizardFrame } from "@/components/onboarding/OnboardingWizardFrame";
import { PlanStep } from "@/components/onboarding/PlanStep";
import { ScheduleStep } from "@/components/onboarding/ScheduleStep";
import { UnitsStep } from "@/components/onboarding/UnitsStep";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { GeneratePlanDialog } from "@/components/plans/GeneratePlanDialog";
import type { OnboardingCompletionChoice, OnboardingWizardStep } from "@/hooks/onboardingTypes";
import { ONBOARDING_STEPS, useOnboardingWizard } from "@/hooks/useOnboardingWizard";
import { QUERY_KEYS } from "@/lib/api";
import { getTodayString } from "@/lib/dateUtils";

interface OnboardingWizardProps {
  readonly open: boolean;
  readonly onComplete: (choice: OnboardingCompletionChoice) => void;
}

const TITLES: Record<OnboardingWizardStep, string> = {
  welcome: "Welcome to fitai.coach",
  units: "Set Your Preferences",
  goal: "What's Your Goal?",
  fuelling: "Fuel Your Training",
  coach: "Meet Your AI Coach",
  plan: "Choose Your Path",
  schedule: "When Do You Start?",
};
const DESCS: Record<OnboardingWizardStep, string> = {
  welcome: "Let's get you set up in just a few steps.",
  units: "Choose your measurement units and HYROX race profile.",
  goal: "This helps us tailor your experience.",
  fuelling: "Get suggested daily nutrition targets from your body profile.",
  coach: "Choose whether the AI Coach can use your training data.",
  plan: "How would you like to start training?",
  schedule: "Pick the first day of your 8-week program.",
};

export function OnboardingWizard({ open, onComplete }: Readonly<OnboardingWizardProps>) {
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // "Run setup again" is how an established athlete switches plans, so the
  // generator gets their plans and can offer to archive the one it overlaps
  // (onboarding audit H2). A first run simply has none.
  const { data: existingPlans } = useQuery<TrainingPlan[]>({ queryKey: QUERY_KEYS.plans });
  const {
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
    mafCategory,
    setMafCategory,
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
    ageError,
    mafErrors,
    raceDate,
    setRaceDate,
    goalDescription,
    activityLevel,
    setActivityLevel,
    weightGoalDirection,
    setWeightGoalDirection,
    applyTargets,
    setApplyTargets,
    aiCoachEnabled,
    setAiCoachEnabled,
    handleNext,
    handleSkip,
    handleImportPlan,
    handleLeaveSetup,
    handleBack,
    handleStartTraining,
    handleUseSamplePlan,
    handleGeneratedPlan,
    nextLabel,
    isPrefsPending,
    isSchedulePending,
  } = useOnboardingWizard(onComplete);

  // Esc and ✕ ask before leaving: one reflexive keypress used to end
  // onboarding for good (onboarding audit H4). Backdrop clicks stay blocked in
  // the frame.
  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setConfirmLeave(true);
  };

  // Enter in a step's text field does what Continue does.
  const handleEnter = () => {
    handleNext().catch(() => {
      // Nothing to add: each step reports its own save failure in a toast.
    });
  };

  return (
    <>
      <OnboardingWizardFrame
        open={open}
        onOpenChange={handleDialogOpenChange}
        title={TITLES[step]}
        description={DESCS[step]}
        step={step}
        steps={ONBOARDING_STEPS}
        idx={idx}
        total={total}
        onEnter={step === "plan" || step === "schedule" ? undefined : handleEnter}
        footer={
          <OnboardingWizardFooter
            step={step}
            onBack={handleBack}
            onNext={handleNext}
            onStartTraining={handleStartTraining}
            isPrefsPending={isPrefsPending}
            isSchedulePending={isSchedulePending}
            nextLabel={nextLabel}
          />
        }
      >
        {step === "welcome" && <WelcomeStep />}
        {step === "units" && (
          <UnitsStep
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            division={division}
            gender={gender}
            age={age}
            ageError={ageError}
            onWeightUnitChange={setWeightUnit}
            onDistanceUnitChange={setDistanceUnit}
            onDivisionChange={setDivision}
            onGenderChange={setGender}
            onAgeChange={setAge}
          />
        )}
        {step === "goal" && (
          <GoalStep
            selectedGoal={selectedGoal}
            onGoalChange={setSelectedGoal}
            trainingStyleId={trainingStyleId}
            onTrainingStyleChange={setTrainingStyleId}
            mafAge={mafAge}
            onMafAgeChange={setMafAge}
            mafCategory={mafCategory}
            onMafCategoryChange={setMafCategory}
            mafHrDataAvailable={mafHrDataAvailable}
            onMafHrDataAvailableChange={setMafHrDataAvailable}
            mafErrors={mafErrors}
            raceDate={raceDate}
            onRaceDateChange={setRaceDate}
            minRaceDate={getTodayString()}
          />
        )}
        {step === "fuelling" && (
          <FuellingStep
            fields={{
              bodyweight,
              heightCm,
              age,
              activityLevel,
              weightGoalDirection,
              weightUnit,
              gender,
            }}
            onBodyweightChange={setBodyweight}
            onHeightCmChange={setHeightCm}
            onAgeChange={setAge}
            onActivityLevelChange={setActivityLevel}
            onWeightGoalDirectionChange={setWeightGoalDirection}
            applyTargets={applyTargets}
            onApplyTargetsChange={setApplyTargets}
          />
        )}
        {step === "coach" && (
          <CoachStep aiCoachEnabled={aiCoachEnabled} onAiCoachEnabledChange={setAiCoachEnabled} />
        )}
        {step === "plan" && (
          <>
            <PlanStep
              aiCoachEnabled={aiCoachEnabled}
              onUseSamplePlan={handleUseSamplePlan}
              onImportPlan={handleImportPlan}
              onGeneratePlan={() => setShowGenerateDialog(true)}
              onSkip={handleSkip}
            />
            <GeneratePlanDialog
              mode="onboarding"
              initialGoal={goalDescription}
              initialStartDate={format(startDate, "yyyy-MM-dd")}
              initialRaceDate={raceDate || undefined}
              existingPlans={existingPlans}
              aiCoachEnabled={aiCoachEnabled}
              open={showGenerateDialog}
              onOpenChange={setShowGenerateDialog}
              onGenerated={handleGeneratedPlan}
            />
          </>
        )}
        {step === "schedule" && (
          <ScheduleStep startDate={startDate} onStartDateChange={setStartDate} />
        )}
      </OnboardingWizardFrame>
      <LeaveSetupDialog
        open={open && confirmLeave}
        onOpenChange={setConfirmLeave}
        onLeave={handleLeaveSetup}
      />
    </>
  );
}
