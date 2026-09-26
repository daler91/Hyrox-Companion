import { formatSecondsToClock } from "@shared/formatClock";
import type { User } from "@shared/schema";

import { buildUnsubscribeUrl, getAppUrl } from "./emailUnsubscribeToken";
import { markdownToEmailHtml } from "./utils/markdownToEmailHtml";
import { sanitizeHtml } from "./utils/sanitize";

export { getAppUrl };

export interface WeeklySummaryData {
  /** Workouts LOGGED this week, on-plan or not. Never a rate denominator. */
  completedCount: number;
  /** Plan days completed. The completion-rate numerator. */
  planCompletedCount: number;
  /** Plan days due this week (completed + planned + missed + skipped, less excused and let go). */
  dueCount: number;
  plannedCount: number;
  missedCount: number;
  skippedCount: number;
  /**
   * Days a declared absence (injury/illness/travel/rest annotation) held out
   * of `missedCount`. Out of the completion-rate denominator too — the week
   * the athlete spent injured is not a week of failures.
   */
  excusedCount: number;
  /**
   * Missed days the athlete let go (missed-session recovery). Out of
   * `missedCount` and the completion-rate denominator: dropping a session on
   * purpose is adjusting the plan, not falling short of it.
   */
  letGoCount: number;
  /**
   * Plan days completed ÷ plan days due, as a percentage. `null` when nothing
   * was due — an athlete with no plan has no completion rate, and reporting
   * one as 100% is what audit H6 was about.
   */
  completionRate: number | null;
  currentStreak: number;
  prsThisWeek: number;
  totalDuration: number;
  weekStartDate: string;
  weekEndDate: string;
}

export interface MissedWorkoutData {
  /** The `plan_days` row id — what `?workout=` deep links to. */
  planDayId: string;
  date: string;
  focus: string;
  mainWorkout: string;
  planName?: string;
}

export function getUserName(user: User): string {
  if (user.firstName) return user.firstName;
  if (user.email) return user.email.split("@")[0];
  return "Athlete";
}

export function baseStyles(): string {
  return `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #0f172a, #1e293b); padding: 32px 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; }
    .header p { color: #94a3b8; margin: 8px 0 0; font-size: 14px; }
    .content { padding: 24px; }
    .stat-grid { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
    .stat-card { flex: 1; min-width: 120px; background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #0f172a; }
    .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .highlight { color: #f59e0b; }
    .section-title { font-size: 16px; font-weight: 600; color: #0f172a; margin: 24px 0 12px; }
    .workout-item { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 8px 0; }
    .workout-focus { font-weight: 600; color: #0f172a; }
    .workout-detail { font-size: 13px; color: #64748b; margin-top: 4px; }
    .cta { display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; margin: 16px 0; }
    .footer { padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { font-size: 12px; color: #94a3b8; margin: 4px 0; }
    .footer a { color: #64748b; text-decoration: underline; }
    .progress-bar { background: #e2e8f0; border-radius: 999px; height: 8px; overflow: hidden; margin: 8px 0; }
    .progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #22c55e, #16a34a); }
  `;
}

/**
 * The footer every athlete email ends with: the preferences link and the
 * login-free unsubscribe link (server/emailUnsubscribeToken.ts). Link text and
 * URLs only — no address or name is rendered here.
 */
export function renderEmailFooter(user: User): string {
  return `<div class="footer">
    <p>fitai.coach — Train Smarter with AI</p>
    <p><a href="${getAppUrl()}/settings">Manage email preferences</a> &middot; <a href="${buildUnsubscribeUrl(user.id)}">Unsubscribe</a></p>
  </div>`;
}

/**
 * Document shell shared by the newer templates: `baseStyles`, the dark header
 * with title and subtitle, the content card, and the standard footer. The
 * older templates keep their own markup so their snapshots stay reviewable.
 */
export function renderEmailShell({
  title,
  subtitle,
  bodyHtml,
  user,
}: {
  title: string;
  subtitle: string;
  bodyHtml: string;
  user: User;
}): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyles()}${shellStyles()}</style></head>
<body style="background:#f4f4f5;padding:16px;">
<div class="container">
  <div class="header">
    <h1>${sanitizeHtml(title)}</h1>
    <p>${sanitizeHtml(subtitle)}</p>
  </div>
  <div class="content">
${bodyHtml}
  </div>
  ${renderEmailFooter(user)}
</div>
</body></html>`;
}

/** Styles only the shell-based templates use, kept out of `baseStyles` so the legacy snapshots stay put. */
function shellStyles(): string {
  return `
    .lead { font-size: 16px; color: #334155; }
    .muted { font-size: 14px; color: #64748b; }
    .quote { background: #f8fafc; border-left: 4px solid #0f172a; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0; color: #334155; font-style: italic; }
    .pr-list { padding-left: 20px; margin: 8px 0; color: #334155; font-size: 14px; }
    .workout-meta { font-size: 13px; color: #64748b; margin-top: 4px; }
    .prose h2, .prose h3, .prose h4 { font-size: 15px; color: #0f172a; margin: 16px 0 6px; }
    .prose p, .prose li { font-size: 14px; color: #334155; line-height: 1.5; margin: 6px 0; }
    .prose ul, .prose ol { padding-left: 20px; margin: 8px 0; }
  `;
}

/** "45 min" / "1h 20m" for a minute count. */
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

/** "06:30" for minutes after local midnight. */
function formatTimeOfDay(minutesAfterMidnight: number): string {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutesAfterMidnight)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

/** Calendar date of an ISO instant, or null when it is not a date at all. */
function isoDateOf(instant: string): string | null {
  const time = Date.parse(instant);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

function ctaButton(href: string, label: string): string {
  return `<div style="text-align:center;margin-top:24px;">
      <a href="${href}" class="cta">${sanitizeHtml(label)}</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// Weekly review reminder — Sunday evening, "the week is wrapping up".
// ---------------------------------------------------------------------------

export interface WeeklyReviewReminderData {
  weekStart: string;
  weekEnd: string;
  weeklyGoal: number;
  /** Sessions logged so far this week, planned or not. */
  sessionsLogged: number;
  /** Plan days scheduled this week (0 for a planless athlete). */
  sessionsPlanned: number;
  plannedCompleted: number;
  missed: number;
  totalDurationMin: number;
  avgRpe: number | null;
  /** All-time bests first set this week, named. */
  personalRecords: { exerciseName: string; metric: string }[];
  /** What the athlete wrote at the end of LAST week's review. */
  previousIntent: string | null;
}

const PR_METRIC_LABELS: Record<string, string> = {
  maxWeight: "heaviest lift",
  maxDistance: "longest distance",
  bestTime: "fastest time",
  estimated1RM: "estimated 1RM",
};

export function buildWeeklyReviewReminderEmail(
  user: User,
  data: WeeklyReviewReminderData,
): { subject: string; html: string } {
  const name = getUserName(user);
  const subject = `Your week is wrapping up — ${data.sessionsLogged} session${pluralSuffix(data.sessionsLogged)} so far`;
  const hasPlan = data.sessionsPlanned > 0;

  const prs = data.personalRecords.slice(0, 5);
  const prSection =
    prs.length > 0
      ? `<div class="section-title">🏆 New personal record${pluralSuffix(prs.length)}</div>
    <ul class="pr-list">${prs
      .map(
        (pr) =>
          `<li>${sanitizeHtml(pr.exerciseName)} — ${sanitizeHtml(PR_METRIC_LABELS[pr.metric] ?? pr.metric)}</li>`,
      )
      .join("")}</ul>`
      : "";

  const intentSection = data.previousIntent
    ? `<div class="section-title">Last week you said</div>
    <div class="quote">“${sanitizeHtml(data.previousIntent)}”</div>
    <p class="muted">Did it happen? Two minutes on the review page turns this week into a plan for the next one.</p>`
    : '<p class="muted">Take two minutes to look back at the week and write one line about what you want from the next one.</p>';

  const missedNote =
    hasPlan && data.missed > 0
      ? `<p class="muted">${data.missed} planned session${pluralSuffix(data.missed)} didn't happen — the review is where you decide what to do about that.</p>`
      : "";

  const reviewUrl = `${getAppUrl()}/review?week=${encodeURIComponent(data.weekStart)}`;

  const bodyHtml = `    <p class="lead">Hey ${sanitizeHtml(name)}, the training week closes tonight. Here's where it stands:</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${data.sessionsLogged}<span style="font-size:14px;color:#64748b;"> / ${data.weeklyGoal}</span></div>
        <div class="stat-label">Sessions vs goal</div>
      </div>
      ${hasPlan ? `<div class="stat-card">
        <div class="stat-value">${data.plannedCompleted}<span style="font-size:14px;color:#64748b;"> of ${data.sessionsPlanned}</span></div>
        <div class="stat-label">Plan days done</div>
      </div>` : ""}
      <div class="stat-card">
        <div class="stat-value">${formatMinutes(data.totalDurationMin)}</div>
        <div class="stat-label">Total time</div>
      </div>
      ${data.avgRpe == null ? "" : `<div class="stat-card">
        <div class="stat-value">${sanitizeHtml(String(data.avgRpe))}</div>
        <div class="stat-label">Avg RPE</div>
      </div>`}
    </div>
    ${missedNote}
    ${prSection}
    ${intentSection}
    ${ctaButton(reviewUrl, "Write this week's review")}`;

  const html = renderEmailShell({
    title: "Your week is wrapping up",
    subtitle: `${data.weekStart} – ${data.weekEnd}`,
    bodyHtml,
    user,
  });
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Session brief — the day's (or tomorrow's) planned session, at the notify hour.
// ---------------------------------------------------------------------------

export interface TodaySessionItem {
  /** The `plan_days` row id — what `?workout=` deep links to. */
  planDayId: string;
  focus: string;
  mainWorkout: string;
  expectedDurationMin: number | null;
  expectedRpe: number | null;
  plannedTimeOfDayMin: number | null;
  planName: string | null;
}

export interface TodaySessionData {
  /** The calendar date the sessions fall on, YYYY-MM-DD. */
  date: string;
  /** True when the brief went out the evening before (an afternoon/evening notify hour). */
  isTomorrow: boolean;
  sessions: TodaySessionItem[];
}

const WORKOUT_EXCERPT_CHARS = 200;

function sessionMetaLine(session: TodaySessionItem): string {
  const parts: string[] = [];
  if (session.expectedDurationMin != null) parts.push(`~${formatMinutes(session.expectedDurationMin)}`);
  if (session.expectedRpe != null) parts.push(`RPE ${sanitizeHtml(String(session.expectedRpe))}`);
  if (session.plannedTimeOfDayMin != null) parts.push(formatTimeOfDay(session.plannedTimeOfDayMin));
  if (session.planName) parts.push(sanitizeHtml(session.planName));
  return parts.join(" · ");
}

/** Where the brief's tap should land: the session when there is one, the timeline otherwise. */
export function todaySessionDeepLink(sessions: readonly TodaySessionItem[]): string {
  const [first] = sessions;
  return sessions.length === 1 && first ? `/?workout=${encodeURIComponent(first.planDayId)}` : "/";
}

export function buildTodaySessionEmail(
  user: User,
  data: TodaySessionData,
): { subject: string; html: string } {
  const name = getUserName(user);
  const dayWord = data.isTomorrow ? "Tomorrow" : "Today";
  const [first] = data.sessions;
  const subject =
    data.sessions.length === 1 && first
      ? `${dayWord}: ${first.focus}`
      : `${dayWord}: ${data.sessions.length} sessions`;

  const items = data.sessions
    .map((session) => {
      const meta = sessionMetaLine(session);
      const excerpt = session.mainWorkout.substring(0, WORKOUT_EXCERPT_CHARS);
      const ellipsis = session.mainWorkout.length > WORKOUT_EXCERPT_CHARS ? "…" : "";
      return `
    <div class="workout-item">
      <div class="workout-focus">${sanitizeHtml(session.focus)}</div>
      ${meta ? `<div class="workout-meta">${meta}</div>` : ""}
      <div class="workout-detail">${sanitizeHtml(excerpt)}${ellipsis}</div>
    </div>`;
    })
    .join("");

  const sessionUrl = `${getAppUrl()}${todaySessionDeepLink(data.sessions)}`;

  const bodyHtml = `    <p class="lead">Hey ${sanitizeHtml(name)}, here's what's on the plan for ${data.isTomorrow ? "tomorrow" : "today"}:</p>
${items}
    <p class="muted">Open the session to see the full prescription, log it, or move it to another day.</p>
    ${ctaButton(sessionUrl, data.sessions.length === 1 ? "Open the session" : "See the plan")}`;

  const html = renderEmailShell({
    title: `${dayWord}'s training`,
    subtitle: data.date,
    bodyHtml,
    user,
  });
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Analysis digest — the stored race prediction and coach insights, no new AI spend.
// ---------------------------------------------------------------------------

export interface AnalysisDigestRacePrediction {
  totalFinishSeconds: number;
  overallConfidence: string;
  percentile: { fasterThanPct: number; cohortLabel: string; cohortSize: number } | null;
  raceReadiness: { status: string; guidance: string } | null;
  /** ISO instant the prediction was generated. */
  generatedAt: string;
}

export interface AnalysisDigestData {
  racePrediction: AnalysisDigestRacePrediction | null;
  /** The coach's Markdown, rendered through markdownToEmailHtml. */
  coachInsightsMarkdown: string | null;
  /** ISO instant the insights were generated. */
  coachInsightsGeneratedAt: string | null;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const READINESS_LABELS: Record<string, string> = {
  peaked: "Peaked",
  fresh: "Fresh",
  neutral: "Race-ready",
  fatigued: "Fatigued",
  very_fatigued: "Very fatigued",
  insufficient_data: "Not enough data",
};

function racePredictionSection(prediction: AnalysisDigestRacePrediction): string {
  const percentile = prediction.percentile
    ? `<p class="muted" style="text-align:center;">Faster than <strong>${sanitizeHtml(String(prediction.percentile.fasterThanPct))}%</strong> of ${sanitizeHtml(prediction.percentile.cohortLabel)} · ${sanitizeHtml(prediction.percentile.cohortSize.toLocaleString("en-US"))} results</p>`
    : "";
  const readiness = prediction.raceReadiness
    ? `<div class="workout-item">
      <div class="workout-focus">Readiness: ${sanitizeHtml(READINESS_LABELS[prediction.raceReadiness.status] ?? prediction.raceReadiness.status)}</div>
      <div class="workout-detail">${sanitizeHtml(prediction.raceReadiness.guidance)}</div>
    </div>`
    : "";
  const generatedOn = isoDateOf(prediction.generatedAt);
  const generatedNote = generatedOn
    ? `<p class="muted">Prediction updated ${generatedOn}.</p>`
    : "";
  return `    <div class="section-title">Race prediction</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${sanitizeHtml(formatSecondsToClock(prediction.totalFinishSeconds))}</div>
        <div class="stat-label">${sanitizeHtml(CONFIDENCE_LABELS[prediction.overallConfidence] ?? "Predicted finish")}</div>
      </div>
    </div>
    ${percentile}
    ${readiness}
    ${generatedNote}`;
}

export function buildAnalysisDigestEmail(
  user: User,
  data: AnalysisDigestData,
): { subject: string; html: string } {
  const name = getUserName(user);
  const subject = data.racePrediction
    ? `Your training analysis: predicted finish ${formatSecondsToClock(data.racePrediction.totalFinishSeconds)}`
    : "Your coach insights are ready";

  const predictionSection = data.racePrediction ? racePredictionSection(data.racePrediction) : "";
  const insightsGeneratedOn = data.coachInsightsGeneratedAt ? isoDateOf(data.coachInsightsGeneratedAt) : null;
  const insightsNote = insightsGeneratedOn
    ? `<p class="muted">Insights updated ${insightsGeneratedOn}.</p>`
    : "";
  const insightsSection = data.coachInsightsMarkdown
    ? `    <div class="section-title">Coach insights</div>
    <div class="prose">${markdownToEmailHtml(data.coachInsightsMarkdown)}</div>
    ${insightsNote}`
    : "";

  const analyticsUrl = `${getAppUrl()}/analytics`;

  const bodyHtml = `    <p class="lead">Hey ${sanitizeHtml(name)}, a fresh read on your training has landed:</p>
${predictionSection}
${insightsSection}
    ${ctaButton(analyticsUrl, "Open your analytics")}`;

  const html = renderEmailShell({
    title: "Your training analysis",
    subtitle: "Race prediction and coach insights",
    bodyHtml,
    user,
  });
  return { subject, html };
}

// Three tones, in priority order: real misses get the gentle nudge, an
// absence-only week gets a neutral acknowledgement (cheering "Perfect week!
// Keep it up! 💪" at someone who spent it injured reads as not having
// listened), and only a genuinely clean week gets the celebration.
function weeklyMissedSessionsMessage(data: WeeklySummaryData): string {
  const excusedNote =
    data.excusedCount > 0
      ? `<p style="font-size:14px;color:#64748b;margin-top:8px;">${data.excusedCount} planned session${pluralSuffix(data.excusedCount)} fell inside an injury, illness, travel or rest window you logged — not counted as missed.</p>`
      : "";
  const letGoNote =
    data.letGoCount > 0
      ? `<p style="font-size:14px;color:#64748b;margin-top:8px;">${data.letGoCount} missed session${pluralSuffix(data.letGoCount)} you chose to let go — not counted as missed.</p>`
      : "";
  if (data.missedCount > 0) {
    return `<p style="font-size:14px;color:#64748b;margin-top:16px;">You missed ${data.missedCount} session${pluralSuffix(data.missedCount)} this week. Don't worry — consistency over perfection!</p>${excusedNote}${letGoNote}`;
  }
  if (data.excusedCount > 0 || data.letGoCount > 0) {
    return `${excusedNote}${letGoNote}`;
  }
  return '<p style="font-size:14px;color:#16a34a;margin-top:16px;font-weight:600;">Perfect week — no missed sessions! Keep it up! 💪</p>';
}

export function buildWeeklySummaryEmail(
  user: User,
  data: WeeklySummaryData,
): { subject: string; html: string } {
  const name = getUserName(user);
  // The caption counts PLAN days on both sides, so it can no longer read
  // "3 of 3 planned sessions" to an athlete who has no plan (audit H6).
  const hasPlan = data.completionRate != null && data.dueCount > 0;
  const durationHours = Math.floor(data.totalDuration / 60);
  const durationMins = data.totalDuration % 60;
  const durationStr =
    durationHours > 0
      ? `${durationHours}h ${durationMins}m`
      : `${durationMins}m`;

  const subject = `Your Week in Review: ${data.completedCount} workout${pluralSuffix(data.completedCount)} completed`;

  const prsSection =
    data.prsThisWeek > 0
      ? `
      <div class="stat-card">
        <div class="stat-value highlight">🏆 ${data.prsThisWeek}</div>
        <div class="stat-label">New PRs</div>
      </div>`
      : "";

  const missedSessionsMessage = weeklyMissedSessionsMessage(data);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyles()}</style></head>
<body style="background:#f4f4f5;padding:16px;">
<div class="container">
  <div class="header">
    <h1>Weekly Training Summary</h1>
    <p>${sanitizeHtml(data.weekStartDate)} – ${sanitizeHtml(data.weekEndDate)}</p>
  </div>
  <div class="content">
    <p style="font-size:16px;color:#334155;">Hey ${sanitizeHtml(name)}, here's how your week went:</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${data.completedCount}</div>
        <div class="stat-label">Completed</div>
      </div>
      ${hasPlan ? `<div class="stat-card">
        <div class="stat-value">${data.completionRate}%</div>
        <div class="stat-label">Completion Rate</div>
      </div>` : ""}
      <div class="stat-card">
        <div class="stat-value">${durationStr}</div>
        <div class="stat-label">Total Time</div>
      </div>
    </div>
${hasPlan ? `
    <div class="section-title">Completion</div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${Math.min(data.completionRate ?? 0, 100)}%"></div>
    </div>
    <p style="font-size:13px;color:#64748b;">${data.planCompletedCount} of ${data.dueCount} planned sessions</p>` : ""}
${data.currentStreak > 0 ? `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value highlight">🔥 ${data.currentStreak}</div>
        <div class="stat-label">Day Streak</div>
      </div>${prsSection}
    </div>` : ""}

    ${missedSessionsMessage}

    <div style="text-align:center;margin-top:24px;">
      <a href="${getAppUrl()}/review?week=${encodeURIComponent(data.weekStartDate)}" class="cta">See your week in review</a>
    </div>
  </div>
  ${renderEmailFooter(user)}
</div>
</body></html>`;

  return { subject, html };
}

export function buildMissedWorkoutEmail(
  user: User,
  missed: MissedWorkoutData[],
): { subject: string; html: string } {
  const name = getUserName(user);
  const count = missed.length;
  let pluralSuffix = "";
  let wasWere = "was";
  if (count !== 1) {
    pluralSuffix = "s";
    wasWere = "were";
  }
  const subject = `${count} missed workout${pluralSuffix} — get back on track`;

  const workoutItems = missed
    .map(
      (w) => `
    <div class="workout-item">
      <div class="workout-focus">${sanitizeHtml(w.focus)}</div>
      <div class="workout-detail">${sanitizeHtml(w.mainWorkout.substring(0, 120))}${w.mainWorkout.length > 120 ? "..." : ""}</div>
      <div class="workout-date">${sanitizeHtml(w.date)}${w.planName ? ` • ${sanitizeHtml(w.planName)}` : ""}</div>
    </div>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { text-align: center; margin-bottom: 30px; }
  .header h1 { color: #0f172a; margin-bottom: 5px; }
  .header p { color: #64748b; margin-top: 0; }
  .content { background: #f8fafc; padding: 24px; border-radius: 8px; }
  .workout-item { background: white; padding: 16px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
  .workout-focus { font-weight: 600; color: #0f172a; margin-bottom: 4px; }
  .workout-detail { color: #475569; font-size: 14px; margin-bottom: 8px; }
  .workout-date { color: #64748b; font-size: 12px; }
  .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #94a3b8; }
  .footer p { margin: 4px 0; }
  .footer a { color: #64748b; text-decoration: underline; }
</style>
</head>
<body>
  <div class="header">
    <h1>Missed Workout Reminder</h1>
    <p>Don't let momentum slip away</p>
  </div>
  <div class="content">
    <p style="font-size:16px;color:#334155;">Hey ${sanitizeHtml(name)}, you had ${count} planned session${pluralSuffix} that ${wasWere} missed:</p>
${workoutItems}
    <p style="font-size:14px;color:#64748b;margin-top:16px;">Missing a session happens to everyone. Open it in the app to fold it into another day, shorten it, or let it go — each option shows what it does to the rest of your plan.</p>

    <div style="margin-top: 24px; text-align: center;">
      <a href="${getAppUrl()}/" style="display: inline-block; background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Timeline</a>
    </div>
  </div>
  ${renderEmailFooter(user)}
</body>
</html>`;

  return { subject, html };
}

export function buildMafTestReminderEmail(user: User): { subject: string; html: string } {
  const name = getUserName(user);
  const subject = "Time for your MAF test";

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { text-align: center; margin-bottom: 30px; }
  .header h1 { color: #0f172a; margin-bottom: 5px; }
  .header p { color: #64748b; margin-top: 0; }
  .content { background: #f8fafc; padding: 24px; border-radius: 8px; }
  .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #94a3b8; }
  .footer p { margin: 4px 0; }
  .footer a { color: #64748b; text-decoration: underline; }
</style>
</head>
<body>
  <div class="header">
    <h1>Time for your MAF test</h1>
    <p>Check in on your aerobic progress</p>
  </div>
  <div class="content">
    <p style="font-size:16px;color:#334155;">Hey ${sanitizeHtml(name)}, it's time for a MAF test.</p>
    <p style="font-size:14px;color:#475569;">Run a fixed distance or time holding your heart rate at or just under your MAF ceiling, then log the run. Comparing your pace at the same heart rate over time is how you'll see your aerobic base improving.</p>
    <div style="margin-top: 24px; text-align: center;">
      <a href="${getAppUrl()}/log" style="display: inline-block; background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Log your run</a>
    </div>
  </div>
  ${renderEmailFooter(user)}
</body>
</html>`;

  return { subject, html };
}
