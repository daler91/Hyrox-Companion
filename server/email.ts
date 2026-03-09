import { Resend } from 'resend';
import type { User } from '@shared/schema';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email };
}

async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail: fromEmail || 'HyroxTracker <noreply@resend.dev>'
  };
}

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

function getUserName(user: User): string {
  if (user.firstName) return user.firstName;
  if (user.email) return user.email.split('@')[0];
  return 'Athlete';
}

function baseStyles(): string {
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

export function buildWeeklySummaryEmail(user: User, data: WeeklySummaryData): { subject: string; html: string } {
  const name = getUserName(user);
  const totalWorkouts = data.completedCount + data.missedCount + data.skippedCount;
  const durationHours = Math.floor(data.totalDuration / 60);
  const durationMins = data.totalDuration % 60;
  const durationStr = durationHours > 0 ? `${durationHours}h ${durationMins}m` : `${durationMins}m`;

  const subject = `Your Week in Review: ${data.completedCount} workout${data.completedCount !== 1 ? 's' : ''} completed`;

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

    ${data.completionRate > 0 ? `
    <div class="section-title">Completion</div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${Math.min(data.completionRate, 100)}%"></div>
    </div>
    <p style="font-size:13px;color:#64748b;">${data.completedCount} of ${totalWorkouts} planned sessions</p>
    ` : ''}

    ${data.currentStreak > 0 ? `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value highlight">🔥 ${data.currentStreak}</div>
        <div class="stat-label">Day Streak</div>
      </div>
      ${data.prsThisWeek > 0 ? `
      <div class="stat-card">
        <div class="stat-value highlight">🏆 ${data.prsThisWeek}</div>
        <div class="stat-label">New PRs</div>
      </div>` : ''}
    </div>` : ''}

    ${data.missedCount > 0 ? `
    <p style="font-size:14px;color:#64748b;margin-top:16px;">You missed ${data.missedCount} session${data.missedCount !== 1 ? 's' : ''} this week. Don't worry — consistency over perfection!</p>
    ` : `
    <p style="font-size:14px;color:#16a34a;margin-top:16px;font-weight:600;">Perfect week — no missed sessions! Keep it up! 💪</p>
    `}

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

export function buildMissedWorkoutEmail(user: User, missed: MissedWorkoutData[]): { subject: string; html: string } {
  const name = getUserName(user);
  const count = missed.length;
  const subject = `${count} missed workout${count !== 1 ? 's' : ''} — get back on track`;

  const workoutItems = missed.map(w => `
    <div class="workout-item">
      <div class="workout-focus">${w.focus}</div>
      <div class="workout-detail">${w.mainWorkout.substring(0, 120)}${w.mainWorkout.length > 120 ? '...' : ''}</div>
      <div class="workout-detail">${w.date}${w.planName ? ` · ${w.planName}` : ''}</div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyles()}</style></head>
<body style="background:#f4f4f5;padding:16px;">
<div class="container">
  <div class="header">
    <h1>Missed Workout Reminder</h1>
    <p>Don't let momentum slip away</p>
  </div>
  <div class="content">
    <p style="font-size:16px;color:#334155;">Hey ${name}, you had ${count} planned session${count !== 1 ? 's' : ''} that ${count !== 1 ? 'were' : 'was'} missed:</p>
    
    ${workoutItems}

    <p style="font-size:14px;color:#64748b;margin-top:16px;">Missing a session happens to everyone. The important thing is to get back on track. You can mark these as skipped or reschedule them in the app.</p>

    <div style="text-align:center;margin-top:24px;">
      <a href="${getAppUrl()}" class="cta">Open HyroxTracker</a>
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

function getAppUrl(): string {
  if (process.env.REPLIT_DEPLOYMENT_URL) return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return 'https://hyroxtracker.replit.app';
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const result = await client.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      html,
    });
    if (result.error) {
      console.error('Resend error:', result.error);
      return false;
    }
    console.log(`Email sent to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

export async function sendWeeklySummary(user: User, data: WeeklySummaryData): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildWeeklySummaryEmail(user, data);
  return sendEmail(user.email, subject, html);
}

export async function sendMissedWorkoutReminder(user: User, missed: MissedWorkoutData[]): Promise<boolean> {
  if (!user.email || missed.length === 0) return false;
  const { subject, html } = buildMissedWorkoutEmail(user, missed);
  return sendEmail(user.email, subject, html);
}
