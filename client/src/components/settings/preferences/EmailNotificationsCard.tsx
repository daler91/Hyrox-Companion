import {
  DEFAULT_NOTIFY_HOUR,
  type EmailNotifyKind,
  fallbackNotifyHour,
} from "@shared/notifyHours";
import { Mail } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PreferenceSelectRow, PreferenceSwitchRow } from "./PreferenceRows";

/** A per-email send hour, or null when the email follows the default send time. */
export type NotifyHourOverride = number | null;

interface EmailNotificationsCardProps {
  readonly emailNotifications: boolean;
  readonly emailWeeklySummary: boolean;
  readonly emailMissedReminder: boolean;
  readonly emailWeeklyReviewReminder: boolean;
  readonly emailTodaySession: boolean;
  readonly emailAnalysisDigest: boolean;
  /** Local hour (0–23) an email goes out at when it has no time of its own. */
  readonly notifyHour: number;
  readonly notifyHourWeeklySummary: NotifyHourOverride;
  readonly notifyHourMissedReminder: NotifyHourOverride;
  readonly notifyHourWeeklyReviewReminder: NotifyHourOverride;
  readonly notifyHourTodaySession: NotifyHourOverride;
  readonly notifyHourAnalysisDigest: NotifyHourOverride;
  readonly onEmailNotificationsChange: (checked: boolean) => void;
  readonly onEmailWeeklySummaryChange: (checked: boolean) => void;
  readonly onEmailMissedReminderChange: (checked: boolean) => void;
  readonly onEmailWeeklyReviewReminderChange: (checked: boolean) => void;
  readonly onEmailTodaySessionChange: (checked: boolean) => void;
  readonly onEmailAnalysisDigestChange: (checked: boolean) => void;
  readonly onNotifyHourChange: (hour: number) => void;
  readonly onNotifyHourWeeklySummaryChange: (hour: NotifyHourOverride) => void;
  readonly onNotifyHourMissedReminderChange: (hour: NotifyHourOverride) => void;
  readonly onNotifyHourWeeklyReviewReminderChange: (hour: NotifyHourOverride) => void;
  readonly onNotifyHourTodaySessionChange: (hour: NotifyHourOverride) => void;
  readonly onNotifyHourAnalysisDigestChange: (hour: NotifyHourOverride) => void;
}

/** "07:00", "18:00" — the wall-clock label for an hour-of-day option. */
export function formatNotifyHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: formatNotifyHourLabel(hour),
}));

/** The sentinel option value: Radix Select cannot hold an empty-string value. */
const FOLLOW_DEFAULT_VALUE = "default";

interface EmailTypeRowProps {
  readonly id: string;
  readonly kind: EmailNotifyKind;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly testId: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly hour: NotifyHourOverride;
  readonly onHourChange: (hour: NotifyHourOverride) => void;
  readonly hourTestId: string;
  /** The athlete's default send time, shown as the fallback option's hour. */
  readonly notifyHour: number;
}

/**
 * One email type: its opt-in switch plus the send time that email alone goes
 * out at. The time control appears only once the email is switched on — an
 * hour for an email you don't receive is noise — and offers "Default" so an
 * athlete who wants one time for everything still only sets it once.
 */
function EmailTypeRow({
  id,
  kind,
  label,
  description,
  checked,
  onCheckedChange,
  testId,
  ariaLabel,
  disabled,
  hour,
  onHourChange,
  hourTestId,
  notifyHour,
}: EmailTypeRowProps) {
  const descId = `${hourTestId}-desc`;
  const defaultHourLabel = formatNotifyHourLabel(fallbackNotifyHour(kind, notifyHour));
  return (
    <div className="space-y-2">
      <PreferenceSwitchRow
        id={id}
        label={label}
        description={description}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        testId={testId}
        ariaLabel={ariaLabel}
      />
      {checked && !disabled ? (
        <div className="flex items-center gap-2">
          <Label htmlFor={hourTestId} className="cursor-pointer text-sm text-muted-foreground">
            Send at
          </Label>
          <p id={descId} className="sr-only">
            {`Local hour the ${label.toLowerCase()} email goes out at.`}
          </p>
          <Select
            value={hour == null ? FOLLOW_DEFAULT_VALUE : String(hour)}
            onValueChange={(value) => {
              onHourChange(value === FOLLOW_DEFAULT_VALUE ? null : Number(value));
            }}
          >
            <SelectTrigger
              id={hourTestId}
              className="h-8 w-40"
              data-testid={hourTestId}
              aria-describedby={descId}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FOLLOW_DEFAULT_VALUE}>{`Default (${defaultHourLabel})`}</SelectItem>
              {HOUR_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

export function EmailNotificationsCard({
  emailNotifications,
  emailWeeklySummary,
  emailMissedReminder,
  emailWeeklyReviewReminder,
  emailTodaySession,
  emailAnalysisDigest,
  notifyHour,
  notifyHourWeeklySummary,
  notifyHourMissedReminder,
  notifyHourWeeklyReviewReminder,
  notifyHourTodaySession,
  notifyHourAnalysisDigest,
  onEmailNotificationsChange,
  onEmailWeeklySummaryChange,
  onEmailMissedReminderChange,
  onEmailWeeklyReviewReminderChange,
  onEmailTodaySessionChange,
  onEmailAnalysisDigestChange,
  onNotifyHourChange,
  onNotifyHourWeeklySummaryChange,
  onNotifyHourMissedReminderChange,
  onNotifyHourWeeklyReviewReminderChange,
  onNotifyHourTodaySessionChange,
  onNotifyHourAnalysisDigestChange,
}: EmailNotificationsCardProps) {
  const briefHour = notifyHourTodaySession ?? notifyHour ?? DEFAULT_NOTIFY_HOUR;
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
            label="Default send time"
            description="The hour in your local time that emails go out at unless you give one its own time."
            value={String(notifyHour)}
            onValueChange={(value) => {
              onNotifyHourChange(Number(value));
            }}
            options={HOUR_OPTIONS}
            testId="select-notify-hour"
            triggerClassName="w-28"
          />
          <EmailTypeRow
            id="email-weekly-summary-switch"
            kind="weeklySummary"
            label="Weekly summary"
            description="Sent every Monday with your completion rate, streak, and total training time."
            checked={emailWeeklySummary}
            onCheckedChange={onEmailWeeklySummaryChange}
            disabled={!emailNotifications}
            testId="switch-email-weekly-summary"
            ariaLabel="Weekly summary email toggle"
            hour={notifyHourWeeklySummary}
            onHourChange={onNotifyHourWeeklySummaryChange}
            hourTestId="select-notify-hour-weekly-summary"
            notifyHour={notifyHour}
          />
          <EmailTypeRow
            id="email-missed-reminder-switch"
            kind="missedReminder"
            label="Missed workout reminder"
            description="Sent the day after you miss a planned workout so you can catch up."
            checked={emailMissedReminder}
            onCheckedChange={onEmailMissedReminderChange}
            disabled={!emailNotifications}
            testId="switch-email-missed-reminder"
            ariaLabel="Missed workout reminder toggle"
            hour={notifyHourMissedReminder}
            onHourChange={onNotifyHourMissedReminderChange}
            hourTestId="select-notify-hour-missed-reminder"
            notifyHour={notifyHour}
          />
          <EmailTypeRow
            id="email-weekly-review-reminder-switch"
            kind="weeklyReviewReminder"
            label="Weekly review reminder"
            description="Sent Sunday with the week so far and a link to write your review."
            checked={emailWeeklyReviewReminder}
            onCheckedChange={onEmailWeeklyReviewReminderChange}
            disabled={!emailNotifications}
            testId="switch-email-weekly-review-reminder"
            ariaLabel="Weekly review reminder email toggle"
            hour={notifyHourWeeklyReviewReminder}
            onHourChange={onNotifyHourWeeklyReviewReminderChange}
            hourTestId="select-notify-hour-weekly-review-reminder"
            notifyHour={notifyHour}
          />
          <EmailTypeRow
            id="email-today-session-switch"
            kind="todaySession"
            label="Session brief"
            description={
              briefHour >= 12
                ? "On training days, tomorrow's planned session — its send time is after midday."
                : "On training days, the day's planned session."
            }
            checked={emailTodaySession}
            onCheckedChange={onEmailTodaySessionChange}
            disabled={!emailNotifications}
            testId="switch-email-today-session"
            ariaLabel="Session brief email toggle"
            hour={notifyHourTodaySession}
            onHourChange={onNotifyHourTodaySessionChange}
            hourTestId="select-notify-hour-today-session"
            notifyHour={notifyHour}
          />
          <EmailTypeRow
            id="email-analysis-digest-switch"
            kind="analysisDigest"
            label="Analysis digest"
            description="Your race prediction and coach insights by email whenever a fresh analysis lands, at most about once a week."
            checked={emailAnalysisDigest}
            onCheckedChange={onEmailAnalysisDigestChange}
            disabled={!emailNotifications}
            testId="switch-email-analysis-digest"
            ariaLabel="Analysis digest email toggle"
            hour={notifyHourAnalysisDigest}
            onHourChange={onNotifyHourAnalysisDigestChange}
            hourTestId="select-notify-hour-analysis-digest"
            notifyHour={notifyHour}
          />
        </div>
      </CardContent>
    </Card>
  );
}
