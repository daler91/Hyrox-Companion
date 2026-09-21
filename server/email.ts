import type { User } from "@shared/schema";
import { Resend } from "resend";

import {
  type AnalysisDigestData,
  buildAnalysisDigestEmail,
  buildMafTestReminderEmail,
  buildMissedWorkoutEmail,
  buildTodaySessionEmail,
  buildWeeklyReviewReminderEmail,
  buildWeeklySummaryEmail,
  type MissedWorkoutData,
  type TodaySessionData,
  type WeeklyReviewReminderData,
  type WeeklySummaryData,
} from "./emailTemplates";
import { buildListUnsubscribeHeaders } from "./emailUnsubscribeToken";
import { env } from "./env";
import { logger } from "./logger";

export * from "./emailTemplates";

function getResendClient() {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }
  const fromEmail =
    env.RESEND_FROM_EMAIL || "fitai.coach <Timmy@fitai.coach>";
  return {
    client: new Resend(apiKey),
    fromEmail,
  };
}

export interface SendEmailOptions {
  /** Extra message headers (List-Unsubscribe and friends). */
  readonly headers?: Record<string, string>;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  options?: SendEmailOptions,
): Promise<boolean> {
  try {
    const { client, fromEmail } = getResendClient();
    const result = await client.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      html,
      ...(options?.headers ? { headers: options.headers } : {}),
    });
    if (result.error) {
      logger.error({ err: result.error }, "Resend error:");
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ err: error }, "Failed to send email:");
    return false;
  }
}

/**
 * Send to an athlete with the one-click unsubscribe headers every athlete
 * email must carry. False (no send) when the account has no address.
 */
export async function sendEmailToUser(
  user: User,
  subject: string,
  html: string,
): Promise<boolean> {
  if (!user.email) return false;
  return await sendEmail(user.email, subject, html, { headers: buildListUnsubscribeHeaders(user.id) });
}

export async function sendWeeklySummary(
  user: User,
  data: WeeklySummaryData,
): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildWeeklySummaryEmail(user, data);
  return sendEmailToUser(user, subject, html);
}

export async function sendMissedWorkoutReminder(
  user: User,
  missed: MissedWorkoutData[],
): Promise<boolean> {
  if (!user.email || missed.length === 0) return false;
  const { subject, html } = buildMissedWorkoutEmail(user, missed);
  return sendEmailToUser(user, subject, html);
}

export async function sendMafTestReminder(user: User): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildMafTestReminderEmail(user);
  return sendEmailToUser(user, subject, html);
}

export async function sendWeeklyReviewReminder(
  user: User,
  data: WeeklyReviewReminderData,
): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildWeeklyReviewReminderEmail(user, data);
  return await sendEmailToUser(user, subject, html);
}

export async function sendTodaySessionBrief(
  user: User,
  data: TodaySessionData,
): Promise<boolean> {
  if (!user.email || data.sessions.length === 0) return false;
  const { subject, html } = buildTodaySessionEmail(user, data);
  return await sendEmailToUser(user, subject, html);
}

export async function sendAnalysisDigest(
  user: User,
  data: AnalysisDigestData,
): Promise<boolean> {
  if (!user.email) return false;
  if (!data.racePrediction && !data.coachInsightsMarkdown) return false;
  const { subject, html } = buildAnalysisDigestEmail(user, data);
  return await sendEmailToUser(user, subject, html);
}
