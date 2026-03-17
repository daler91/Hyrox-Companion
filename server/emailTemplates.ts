import type { User } from "@shared/schema";

export interface WeeklySummaryData {
  completedCount: number;
  plannedCount: number;
  missedCount: number;
  skippedCount: number;
  completionRate: number;
  currentStreak: number;
  prsThisWeek: number;
  totalDuration: number;
  weekStartDate: string;
  weekEndDate: string;
}

export interface MissedWorkoutData {
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

export function getAppUrl(): string {
  if (process.env.REPLIT_DEPLOYMENT_URL)
    return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  if (process.env.REPLIT_DEV_DOMAIN)
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "https://hyroxtracker.replit.app";
}

export function buildWeeklySummaryEmail(
  user: User,
  data: WeeklySummaryData,
): { subject: string; html: string } {
  const name = getUserName(user);
  const totalWorkouts =
    data.completedCount + data.missedCount + data.skippedCount;
  const durationHours = Math.floor(data.totalDuration / 60);
  const durationMins = data.totalDuration % 60;
  const durationStr =
    durationHours > 0
      ? `${durationHours}h ${durationMins}m`
      : `${durationMins}m`;

  let completedSuffix = "s";
  if (data.completedCount === 1) {
    completedSuffix = "";
  }
  const subject = `Your Week in Review: ${data.completedCount} workout${completedSuffix} completed`;

  const prsSection =
    data.prsThisWeek > 0
      ? `
      <div class="stat-card">
        <div class="stat-value highlight">🏆 ${data.prsThisWeek}</div>
        <div class="stat-label">New PRs</div>
      </div>`
      : "";

  let missedSessionsMessage =
    '<p style="font-size:14px;color:#16a34a;margin-top:16px;font-weight:600;">Perfect week — no missed sessions! Keep it up! 💪</p>';
  if (data.missedCount > 0) {
    let missedSuffix = "s";
    if (data.missedCount === 1) {
      missedSuffix = "";
    }
    missedSessionsMessage = `<p style="font-size:14px;color:#64748b;margin-top:16px;">You missed ${data.missedCount} session${missedSuffix} this week. Don't worry — consistency over perfection!</p>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyles()}</style></head>
<body style="background:#f4f4f5;padding:16px;">
<div class="container">
  <div class="header">
    <h1>Weekly Training Summary</h1>
    <p>${data.weekStartDate} – ${data.weekEndDate}</p>
  </div>
  <div class="content">
    <p style="font-size:16px;color:#334155;">Hey ${name}, here's how your week went:</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${data.completedCount}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.completionRate}%</div>
        <div class="stat-label">Completion Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${durationStr}</div>
        <div class="stat-label">Total Time</div>
      </div>
    </div>

    ${
      data.completionRate > 0
        ? `
    <div class="section-title">Completion</div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${Math.min(data.completionRate, 100)}%"></div>
    </div>
    <p style="font-size:13px;color:#64748b;">${data.completedCount} of ${totalWorkouts} planned sessions</p>
    `
        : ""
    }

    ${
      data.currentStreak > 0
        ? `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value highlight">🔥 ${data.currentStreak}</div>
        <div class="stat-label">Day Streak</div>
      </div>
      ${prsSection}
    </div>`
        : ""
    }

    ${missedSessionsMessage}

    <div style="text-align:center;margin-top:24px;">
      <a href="${getAppUrl()}" class="cta">View Your Timeline</a>
    </div>
  </div>
  <div class="footer">
    <p>HyroxTracker — Train Smarter for Hyrox</p>
    <p><a href="${getAppUrl()}/settings">Manage email preferences</a></p>
  </div>
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
      <div class="workout-focus">${w.focus}</div>
      <div class="workout-detail">${w.mainWorkout.substring(0, 120)}${w.mainWorkout.length > 120 ? "..." : ""}</div>
      <div class="workout-date">${w.date}${w.planName ? ` • ${w.planName}` : ""}</div>
    </div>
  `,
    )
    .join("");

  const html = `
<!DOCTYPE html>
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
</style>
</head>
<body>
  <div class="header">
    <h1>Missed Workout Reminder</h1>
    <p>Don't let momentum slip away</p>
  </div>
  <div class="content">
    <p style="font-size:16px;color:#334155;">Hey ${name}, you had ${count} planned session${pluralSuffix} that ${wasWere} missed:</p>

    ${workoutItems}

    <p style="font-size:14px;color:#64748b;margin-top:16px;">Missing a session happens to everyone. The important thing is to get back on track. You can mark these as skipped or reschedule them in the app.</p>

    <div style="margin-top: 24px; text-align: center;">
      <a href="${process.env.APP_URL || "https://hyrox-tracker.com"}/timeline" style="display: inline-block; background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Timeline</a>
    </div>
  </div>
  <div class="footer">
    <p>You're receiving this because you enabled email reminders in your HyroxTracker preferences.</p>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}
