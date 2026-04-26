import { Mail } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSwitchRow } from "./PreferenceRows";

interface EmailNotificationsCardProps {
  readonly emailNotifications: boolean;
  readonly emailWeeklySummary: boolean;
  readonly emailMissedReminder: boolean;
  readonly onEmailNotificationsChange: (checked: boolean) => void;
  readonly onEmailWeeklySummaryChange: (checked: boolean) => void;
  readonly onEmailMissedReminderChange: (checked: boolean) => void;
}

export function EmailNotificationsCard({
  emailNotifications,
  emailWeeklySummary,
  emailMissedReminder,
  onEmailNotificationsChange,
  onEmailWeeklySummaryChange,
  onEmailMissedReminderChange,
}: EmailNotificationsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Email Notifications
        </CardTitle>
        <CardDescription>Choose which training emails you want to receive</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PreferenceSwitchRow
          id="email-notifications-switch"
          label="Receive email"
          description="Master toggle. When off, no email of any type is sent."
          checked={emailNotifications}
          onCheckedChange={onEmailNotificationsChange}
          testId="switch-email-notifications"
          ariaLabel="Master email notifications toggle"
        />

        <div
          className={`space-y-4 pl-4 border-l-2 ml-1 ${
            emailNotifications ? "border-primary/40" : "border-muted opacity-60"
          }`}
        >
          <PreferenceSwitchRow
            id="email-weekly-summary-switch"
            label="Weekly summary"
            description="Sent every Monday with your completion rate, streak, and total training time."
            checked={emailWeeklySummary}
            onCheckedChange={onEmailWeeklySummaryChange}
            disabled={!emailNotifications}
            testId="switch-email-weekly-summary"
            ariaLabel="Weekly summary email toggle"
          />
          <PreferenceSwitchRow
            id="email-missed-reminder-switch"
            label="Missed workout reminder"
            description="Sent the day after you miss a planned workout so you can catch up."
            checked={emailMissedReminder}
            onCheckedChange={onEmailMissedReminderChange}
            disabled={!emailNotifications}
            testId="switch-email-missed-reminder"
            ariaLabel="Missed workout reminder toggle"
          />
        </div>
      </CardContent>
    </Card>
  );
}
