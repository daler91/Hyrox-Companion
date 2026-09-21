import { Mail } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSelectRow, PreferenceSwitchRow } from "./PreferenceRows";

interface EmailNotificationsCardProps {
  readonly emailNotifications: boolean;
  readonly emailWeeklySummary: boolean;
  readonly emailMissedReminder: boolean;
  readonly emailWeeklyReviewReminder: boolean;
  readonly emailTodaySession: boolean;
  readonly emailAnalysisDigest: boolean;
  /** Local hour (0–23) the scheduled emails go out. */
  readonly notifyHour: number;
  readonly onEmailNotificationsChange: (checked: boolean) => void;
  readonly onEmailWeeklySummaryChange: (checked: boolean) => void;
  readonly onEmailMissedReminderChange: (checked: boolean) => void;
  readonly onEmailWeeklyReviewReminderChange: (checked: boolean) => void;
  readonly onEmailTodaySessionChange: (checked: boolean) => void;
  readonly onEmailAnalysisDigestChange: (checked: boolean) => void;
  readonly onNotifyHourChange: (hour: number) => void;
}

/** "07:00", "18:00" — the wall-clock label for an hour-of-day option. */
export function formatNotifyHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

const NOTIFY_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: formatNotifyHourLabel(hour),
}));

export function EmailNotificationsCard({
  emailNotifications,
  emailWeeklySummary,
  emailMissedReminder,
  emailWeeklyReviewReminder,
  emailTodaySession,
  emailAnalysisDigest,
  notifyHour,
  onEmailNotificationsChange,
  onEmailWeeklySummaryChange,
  onEmailMissedReminderChange,
  onEmailWeeklyReviewReminderChange,
  onEmailTodaySessionChange,
  onEmailAnalysisDigestChange,
  onNotifyHourChange,
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
          <PreferenceSelectRow
            label="Send time"
            description="Summaries, reminders and briefs go out at this hour in your local time."
            value={String(notifyHour)}
            onValueChange={(value) => onNotifyHourChange(Number(value))}
            options={NOTIFY_HOUR_OPTIONS}
            testId="select-notify-hour"
            triggerClassName="w-28"
          />
          <PreferenceSwitchRow
            id="email-weekly-summary-switch"
            label="Weekly summary"
            description="Sent every Monday at your send time with your completion rate, streak, and total training time."
            checked={emailWeeklySummary}
            onCheckedChange={onEmailWeeklySummaryChange}
            disabled={!emailNotifications}
            testId="switch-email-weekly-summary"
            ariaLabel="Weekly summary email toggle"
          />
          <PreferenceSwitchRow
            id="email-missed-reminder-switch"
            label="Missed workout reminder"
            description="Sent at your send time the day after you miss a planned workout so you can catch up."
            checked={emailMissedReminder}
            onCheckedChange={onEmailMissedReminderChange}
            disabled={!emailNotifications}
            testId="switch-email-missed-reminder"
            ariaLabel="Missed workout reminder toggle"
          />
          <PreferenceSwitchRow
            id="email-weekly-review-reminder-switch"
            label="Weekly review reminder"
            description="Sent Sunday at 5 pm local with the week so far and a link to write your review."
            checked={emailWeeklyReviewReminder}
            onCheckedChange={onEmailWeeklyReviewReminderChange}
            disabled={!emailNotifications}
            testId="switch-email-weekly-review-reminder"
            ariaLabel="Weekly review reminder email toggle"
          />
          <PreferenceSwitchRow
            id="email-today-session-switch"
            label="Session brief"
            description="On training days, the day's planned session at your send time (tomorrow's if your send time is after midday)."
            checked={emailTodaySession}
            onCheckedChange={onEmailTodaySessionChange}
            disabled={!emailNotifications}
            testId="switch-email-today-session"
            ariaLabel="Session brief email toggle"
          />
          <PreferenceSwitchRow
            id="email-analysis-digest-switch"
            label="Analysis digest"
            description="Your race prediction and coach insights by email whenever a fresh analysis lands, at most about once a week."
            checked={emailAnalysisDigest}
            onCheckedChange={onEmailAnalysisDigestChange}
            disabled={!emailNotifications}
            testId="switch-email-analysis-digest"
            ariaLabel="Analysis digest email toggle"
          />
        </div>
      </CardContent>
    </Card>
  );
}
