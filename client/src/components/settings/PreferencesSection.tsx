import { BrainCircuit, Mail } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface PreferencesSectionProps {
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly weeklyGoal: string;
  readonly emailNotifications: boolean;
  readonly emailWeeklySummary: boolean;
  readonly emailMissedReminder: boolean;
  readonly aiCoachEnabled: boolean;
  readonly onWeightUnitChange: (value: string) => void;
  readonly onDistanceUnitChange: (value: string) => void;
  readonly onWeeklyGoalChange: (value: string) => void;
  readonly onEmailNotificationsChange: (checked: boolean) => void;
  readonly onEmailWeeklySummaryChange: (checked: boolean) => void;
  readonly onEmailMissedReminderChange: (checked: boolean) => void;
  readonly onAiCoachEnabledChange: (checked: boolean) => void;
}

export function PreferencesSection({
  weightUnit,
  distanceUnit,
  weeklyGoal,
  emailNotifications,
  emailWeeklySummary,
  emailMissedReminder,
  aiCoachEnabled,
  onWeightUnitChange,
  onDistanceUnitChange,
  onWeeklyGoalChange,
  onEmailNotificationsChange,
  onEmailWeeklySummaryChange,
  onEmailMissedReminderChange,
  onAiCoachEnabledChange,
}: Readonly<PreferencesSectionProps>) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Units</CardTitle>
          <CardDescription>Choose your preferred measurement units</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Weight Unit</Label>
              <p className="text-sm text-muted-foreground">For sled weights, wall balls, etc.</p>
            </div>
            <Select value={weightUnit} onValueChange={onWeightUnitChange}>
              <SelectTrigger className="w-24" data-testid="select-weight-unit" aria-label="Select weight unit">
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
              <SelectTrigger className="w-24" data-testid="select-distance-unit" aria-label="Select distance unit">
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
          <CardTitle as="h2">Training Goals</CardTitle>
          <CardDescription>Set your weekly training targets</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Weekly Workout Goal</Label>
              <p className="text-sm text-muted-foreground">Target number of workouts per week</p>
            </div>
            <Select value={weeklyGoal} onValueChange={onWeeklyGoalChange}>
              <SelectTrigger className="w-24" data-testid="select-weekly-goal" aria-label="Select weekly workout goal">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Email Notifications
          </CardTitle>
          <CardDescription>Choose which training emails you want to receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="email-notifications-switch" className="cursor-pointer">
                Receive email
              </Label>
              <p className="text-sm text-muted-foreground">
                Master toggle. When off, no email of any type is sent.
              </p>
            </div>
            <Switch
              id="email-notifications-switch"
              checked={emailNotifications}
              onCheckedChange={onEmailNotificationsChange}
              data-testid="switch-email-notifications"
              aria-label="Master email notifications toggle"
            />
          </div>

          {/* Per-type sub-toggles. Disabled (and visually dimmed) when the
              master toggle is off so users understand they have no effect. */}
          <div className={`space-y-4 pl-4 border-l-2 ml-1 ${emailNotifications ? "border-primary/40" : "border-muted opacity-60"}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="email-weekly-summary-switch" className="cursor-pointer">
                  Weekly summary
                </Label>
                <p className="text-sm text-muted-foreground">
                  Sent every Monday with your completion rate, streak, and total training time.
                </p>
              </div>
              <Switch
                id="email-weekly-summary-switch"
                checked={emailWeeklySummary}
                onCheckedChange={onEmailWeeklySummaryChange}
                disabled={!emailNotifications}
                data-testid="switch-email-weekly-summary"
                aria-label="Weekly summary email toggle"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="email-missed-reminder-switch" className="cursor-pointer">
                  Missed workout reminder
                </Label>
                <p className="text-sm text-muted-foreground">
                  Sent the day after you miss a planned workout so you can catch up.
                </p>
              </div>
              <Switch
                id="email-missed-reminder-switch"
                checked={emailMissedReminder}
                onCheckedChange={onEmailMissedReminderChange}
                disabled={!emailNotifications}
                data-testid="switch-email-missed-reminder"
                aria-label="Missed workout reminder toggle"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            AI Coach
          </CardTitle>
          <CardDescription>Intelligent workout adjustments powered by Gemini</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="ai-coach-enabled-switch" className="flex items-center gap-2 cursor-pointer">
                Auto-Adjust Workouts
              </Label>
              <p className="text-sm text-muted-foreground">
                After each completed workout, the AI coach analyses your performance and
                automatically adjusts upcoming sessions to keep you on track for your plan goal.
              </p>
            </div>
            <Switch
              id="ai-coach-enabled-switch"
              checked={aiCoachEnabled}
              onCheckedChange={onAiCoachEnabledChange}
              data-testid="switch-ai-coach-enabled"
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
