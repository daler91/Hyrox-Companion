import { AiCoachCard } from "./preferences/AiCoachCard";
import { EmailNotificationsCard } from "./preferences/EmailNotificationsCard";
import { TrainingGoalsCard } from "./preferences/TrainingGoalsCard";
import { UnitsPreferencesCard } from "./preferences/UnitsPreferencesCard";
import { WorkoutReviewCard } from "./preferences/WorkoutReviewCard";

interface PreferencesSectionProps {
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly weeklyGoal: string;
  readonly emailNotifications: boolean;
  readonly emailWeeklySummary: boolean;
  readonly emailMissedReminder: boolean;
  readonly showAdherenceInsights: boolean;
  readonly aiCoachEnabled: boolean;
  readonly onWeightUnitChange: (value: string) => void;
  readonly onDistanceUnitChange: (value: string) => void;
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
  weeklyGoal,
  emailNotifications,
  emailWeeklySummary,
  emailMissedReminder,
  showAdherenceInsights,
  aiCoachEnabled,
  onWeightUnitChange,
  onDistanceUnitChange,
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
