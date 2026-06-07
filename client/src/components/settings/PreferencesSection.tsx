import { AiCoachCard } from "./preferences/AiCoachCard";
import { AthleteProfileCard } from "./preferences/AthleteProfileCard";
import { BodyCompositionCard } from "./preferences/BodyCompositionCard";
import { EmailNotificationsCard } from "./preferences/EmailNotificationsCard";
import { TrainingGoalsCard } from "./preferences/TrainingGoalsCard";
import { UnitsPreferencesCard } from "./preferences/UnitsPreferencesCard";
import { WorkoutReviewCard } from "./preferences/WorkoutReviewCard";

interface PreferencesSectionProps {
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly division: string;
  readonly gender: string;
  readonly ageInput: string;
  readonly bodyweightKg: number | null;
  readonly heightCm: number | null;
  readonly activityLevel: string;
  readonly weightGoalDirection: string;
  readonly weightGoalRateKgPerWeek: number | null;
  readonly weeklyGoal: string;
  readonly emailNotifications: boolean;
  readonly emailWeeklySummary: boolean;
  readonly emailMissedReminder: boolean;
  readonly showAdherenceInsights: boolean;
  readonly aiCoachEnabled: boolean;
  readonly onWeightUnitChange: (value: string) => void;
  readonly onDistanceUnitChange: (value: string) => void;
  readonly onDivisionChange: (value: string) => void;
  readonly onGenderChange: (value: string) => void;
  readonly onAgeInputChange: (value: string) => void;
  readonly onBodyweightKgChange: (value: number | null) => void;
  readonly onHeightCmChange: (value: number | null) => void;
  readonly onActivityLevelChange: (value: string) => void;
  readonly onWeightGoalDirectionChange: (value: string) => void;
  readonly onWeightGoalRateKgPerWeekChange: (value: number | null) => void;
  readonly onWeeklyGoalChange: (value: string) => void;
  readonly onEmailNotificationsChange: (checked: boolean) => void;
  readonly onEmailWeeklySummaryChange: (checked: boolean) => void;
  readonly onEmailMissedReminderChange: (checked: boolean) => void;
  readonly onShowAdherenceInsightsChange: (checked: boolean) => void;
  readonly onAiCoachEnabledChange: (checked: boolean) => void;
}

export function PreferencesSection({
  weightUnit,
  distanceUnit,
  division,
  gender,
  ageInput,
  bodyweightKg,
  heightCm,
  activityLevel,
  weightGoalDirection,
  weightGoalRateKgPerWeek,
  weeklyGoal,
  emailNotifications,
  emailWeeklySummary,
  emailMissedReminder,
  showAdherenceInsights,
  aiCoachEnabled,
  onWeightUnitChange,
  onDistanceUnitChange,
  onDivisionChange,
  onGenderChange,
  onAgeInputChange,
  onBodyweightKgChange,
  onHeightCmChange,
  onActivityLevelChange,
  onWeightGoalDirectionChange,
  onWeightGoalRateKgPerWeekChange,
  onWeeklyGoalChange,
  onEmailNotificationsChange,
  onEmailWeeklySummaryChange,
  onEmailMissedReminderChange,
  onShowAdherenceInsightsChange,
  onAiCoachEnabledChange,
}: Readonly<PreferencesSectionProps>) {
  return (
    <>
      <UnitsPreferencesCard
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        onWeightUnitChange={onWeightUnitChange}
        onDistanceUnitChange={onDistanceUnitChange}
      />
      <AthleteProfileCard
        division={division}
        gender={gender}
        age={ageInput}
        onDivisionChange={onDivisionChange}
        onGenderChange={onGenderChange}
        onAgeChange={onAgeInputChange}
      />
      <BodyCompositionCard
        weightUnit={weightUnit}
        bodyweightKg={bodyweightKg}
        heightCm={heightCm}
        activityLevel={activityLevel}
        weightGoalDirection={weightGoalDirection}
        weightGoalRateKgPerWeek={weightGoalRateKgPerWeek}
        onBodyweightKgChange={onBodyweightKgChange}
        onHeightCmChange={onHeightCmChange}
        onActivityLevelChange={onActivityLevelChange}
        onWeightGoalDirectionChange={onWeightGoalDirectionChange}
        onWeightGoalRateKgPerWeekChange={onWeightGoalRateKgPerWeekChange}
      />
      <TrainingGoalsCard weeklyGoal={weeklyGoal} onWeeklyGoalChange={onWeeklyGoalChange} />
      <EmailNotificationsCard
        emailNotifications={emailNotifications}
        emailWeeklySummary={emailWeeklySummary}
        emailMissedReminder={emailMissedReminder}
        onEmailNotificationsChange={onEmailNotificationsChange}
        onEmailWeeklySummaryChange={onEmailWeeklySummaryChange}
        onEmailMissedReminderChange={onEmailMissedReminderChange}
      />
      <WorkoutReviewCard
        showAdherenceInsights={showAdherenceInsights}
        onShowAdherenceInsightsChange={onShowAdherenceInsightsChange}
      />
      <AiCoachCard
        aiCoachEnabled={aiCoachEnabled}
        onAiCoachEnabledChange={onAiCoachEnabledChange}
      />
    </>
  );
}
