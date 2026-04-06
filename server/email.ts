import type { User } from "@shared/schema";
import { Resend } from "resend";

import {
  buildMissedWorkoutEmail,
  buildWeeklySummaryEmail,
  type MissedWorkoutData,
  type WeeklySummaryData,
} from "./emailTemplates";
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

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    const { client, fromEmail } = getResendClient();
    const result = await client.emails.send({
      from: fromEmail,
      to: [to],
      subject,
      html,
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

export async function sendWeeklySummary(
  user: User,
  data: WeeklySummaryData,
): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildWeeklySummaryEmail(user, data);
  return sendEmail(user.email, subject, html);
}

export async function sendMissedWorkoutReminder(
  user: User,
  missed: MissedWorkoutData[],
): Promise<boolean> {
  if (!user.email || missed.length === 0) return false;
  const { subject, html } = buildMissedWorkoutEmail(user, missed);
  return sendEmail(user.email, subject, html);
}
