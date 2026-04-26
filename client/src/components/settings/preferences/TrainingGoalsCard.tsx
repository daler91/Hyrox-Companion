import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSelectRow } from "./PreferenceRows";

interface TrainingGoalsCardProps {
  readonly weeklyGoal: string;
  readonly onWeeklyGoalChange: (value: string) => void;
}

export function TrainingGoalsCard({ weeklyGoal, onWeeklyGoalChange }: TrainingGoalsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Training Goals</CardTitle>
        <CardDescription>Set your weekly training targets</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PreferenceSelectRow
          label="Weekly Workout Goal"
          description="Target number of workouts per week"
          value={weeklyGoal}
          onValueChange={onWeeklyGoalChange}
          options={["3", "4", "5", "6", "7"].map((value) => ({
            value,
            label: value,
          }))}
          testId="select-weekly-goal"
          ariaLabel="Select weekly workout goal"
        />
      </CardContent>
    </Card>
  );
}
