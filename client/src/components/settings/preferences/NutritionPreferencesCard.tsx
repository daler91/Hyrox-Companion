import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSelectRow } from "./PreferenceRows";

interface NutritionPreferencesCardProps {
  readonly mealSchedule: 3 | 4 | 5;
  readonly onMealScheduleChange: (value: 3 | 4 | 5) => void;
}

export function NutritionPreferencesCard({
  mealSchedule,
  onMealScheduleChange,
}: NutritionPreferencesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Nutrition</CardTitle>
        <CardDescription>How your daily fuel targets are split across the day</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PreferenceSelectRow
          label="Meals per day"
          description="How many meals your per-meal fuel targets are spread across"
          value={String(mealSchedule)}
          onValueChange={(v) => onMealScheduleChange(Number(v) as 3 | 4 | 5)}
          options={[
            { value: "3", label: "3 meals" },
            { value: "4", label: "4 meals" },
            { value: "5", label: "5 meals" },
          ]}
          testId="select-meal-schedule"
          ariaLabel="Select meals per day"
          triggerClassName="w-28"
        />
      </CardContent>
    </Card>
  );
}
