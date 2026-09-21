/**
 * Per-email send hours, shared by the client (Settings) and the server (email
 * scheduler).
 *
 * A leaf module for the same reason as shared/weeklyReview.ts: the Settings
 * form imports these values, and a value-import from the `@shared/schema`
 * barrel would drag the drizzle graph into the browser bundle that
 * `script/bundle-check.ts` exists to protect.
 *
 * Each email kind has its own nullable override column. Null means "no
 * override" and resolves to the athlete's default send time (`notifyHour`) —
 * except the weekly review reminder, whose unset moment stays Sunday evening
 * rather than the morning most athletes pick for everything else.
 */
import { WEEKLY_REVIEW_SUNDAY_EVENING_HOUR } from "./weeklyReview";

/** Local hour the scheduled emails go out when the athlete has not picked one. */
export const DEFAULT_NOTIFY_HOUR = 7;

export const EMAIL_NOTIFY_KINDS = [
  "weeklySummary",
  "missedReminder",
  "weeklyReviewReminder",
  "todaySession",
  "analysisDigest",
] as const;

export type EmailNotifyKind = (typeof EMAIL_NOTIFY_KINDS)[number];

/** The per-kind send-hour override field behind each email kind. */
export const NOTIFY_HOUR_FIELD = {
  weeklySummary: "notifyHourWeeklySummary",
  missedReminder: "notifyHourMissedReminder",
  weeklyReviewReminder: "notifyHourWeeklyReviewReminder",
  todaySession: "notifyHourTodaySession",
  analysisDigest: "notifyHourAnalysisDigest",
} as const satisfies Record<EmailNotifyKind, string>;

export type NotifyHourField = (typeof NOTIFY_HOUR_FIELD)[EmailNotifyKind];

/** The send-hour columns as a reader sees them: the default plus every override. */
export type NotifyHourPreferences = {
  readonly notifyHour?: number | null;
} & {
  readonly [K in NotifyHourField]?: number | null;
};

/** True for an hour-of-day the schedule can actually fire on. */
export function isValidNotifyHour(hour: unknown): hour is number {
  return typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

/**
 * The hour a kind falls back to when it carries no override of its own: the
 * athlete's default send time, or — for the review reminder — the Sunday
 * evening hour the Timeline prompt shares.
 */
export function fallbackNotifyHour(kind: EmailNotifyKind, notifyHour?: number | null): number {
  if (kind === "weeklyReviewReminder") return WEEKLY_REVIEW_SUNDAY_EVENING_HOUR;
  return isValidNotifyHour(notifyHour) ? notifyHour : DEFAULT_NOTIFY_HOUR;
}

/** The local hour this email kind goes out at for this athlete. */
export function resolveNotifyHour(prefs: NotifyHourPreferences, kind: EmailNotifyKind): number {
  const override = prefs[NOTIFY_HOUR_FIELD[kind]];
  return isValidNotifyHour(override) ? override : fallbackNotifyHour(kind, prefs.notifyHour);
}
