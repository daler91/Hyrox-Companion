import { Resend } from "resend";
import type { User } from "@shared/schema";
import {
  buildWeeklySummaryEmail,
  buildMissedWorkoutEmail,
  type WeeklySummaryData,
  type MissedWorkoutData
} from "./emailTemplates";

export { buildWeeklySummaryEmail, buildMissedWorkoutEmail };
export type { WeeklySummaryData, MissedWorkoutData };

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "HyroxTracker <noreply@resend.dev>";
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
      console.error("Resend error:", result.error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to send email:", error);
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
