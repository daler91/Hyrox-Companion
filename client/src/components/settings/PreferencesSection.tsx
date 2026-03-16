import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Mail } from "lucide-react";

interface PreferencesSectionProps {
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly weeklyGoal: string;
  readonly emailNotifications: boolean;
  readonly onWeightUnitChange: (value: string) => void;
  readonly onDistanceUnitChange: (value: string) => void;
  readonly onWeeklyGoalChange: (value: string) => void;
  readonly onEmailNotificationsChange: (checked: boolean) => void;
}

export function PreferencesSection({
  weightUnit,
  distanceUnit,
  weeklyGoal,
  emailNotifications,
  onWeightUnitChange,
  onDistanceUnitChange,
  onWeeklyGoalChange,
  onEmailNotificationsChange,
}: PreferencesSectionProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Units</CardTitle>
          <CardDescription>Choose your preferred measurement units</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Weight Unit</Label>
              <p className="text-sm text-muted-foreground">For sled weights, wall balls, etc.</p>
            </div>
            <Select value={weightUnit} onValueChange={onWeightUnitChange}>
              <SelectTrigger className="w-24" data-testid="select-weight-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">kg</SelectItem>
                <SelectItem value="lbs">lbs</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Distance Unit</Label>
              <p className="text-sm text-muted-foreground">For running, rowing, etc.</p>
            </div>
            <Select value={distanceUnit} onValueChange={onDistanceUnitChange}>
              <SelectTrigger className="w-24" data-testid="select-distance-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">km</SelectItem>
                <SelectItem value="miles">miles</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Training Goals</CardTitle>
          <CardDescription>Set your weekly training targets</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Weekly Workout Goal</Label>
              <p className="text-sm text-muted-foreground">Target number of workouts per week</p>
            </div>
            <Select value={weeklyGoal} onValueChange={onWeeklyGoalChange}>
              <SelectTrigger className="w-24" data-testid="select-weekly-goal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="7">7</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Notifications
              </Label>
              <p className="text-sm text-muted-foreground">Receive weekly training summaries and missed workout reminders</p>
            </div>
            <Switch
              checked={emailNotifications}
              onCheckedChange={onEmailNotificationsChange}
              data-testid="switch-email-notifications"
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
