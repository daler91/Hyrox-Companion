import { createHash } from "node:crypto";

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
  /**
   * Sent as Resend's Idempotency-Key. Resend drops a repeat of the same key
   * within 24 hours, so a retry after a failure that may have sent anyway
   * cannot deliver the email twice.
   */
  readonly idempotencyKey?: string;
}

/**
 * Pauses between attempts at one send. A failure that may pass (Resend's rate
 * limit or a server error, or no response at all) is tried twice more; one
 * that won't (a bad address, key or quota) is not. The job holding the send's
 * claim waits for these, so a short Resend blip no longer costs the athlete
 * that window's email (tech debt #39).
 */
export const EMAIL_SEND_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

const RETRYABLE_RESEND_ERRORS: ReadonlySet<string> = new Set([
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
  "concurrent_idempotent_requests",
]);

type Attempt = "sent" | "retry" | "failed";

async function attemptSend(
  client: Resend,
  payload: Parameters<Resend["emails"]["send"]>[0],
  idempotencyKey: string | undefined,
): Promise<Attempt> {
  try {
    const result = idempotencyKey
      ? await client.emails.send(payload, { idempotencyKey })
      : await client.emails.send(payload);
    if (!result.error) return "sent";
    // Resend's error is its name, HTTP status and message; it carries neither
    // the recipient's address nor the email's content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err: result.error }, "Resend error:");
    return RETRYABLE_RESEND_ERRORS.has(result.error.name) ? "retry" : "failed";
  } catch (error) {
    // A transport failure (no response from Resend): no address or content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err: error }, "Failed to send email:");
    return "retry";
  }
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  options?: SendEmailOptions,
): Promise<boolean> {
  let resend: ReturnType<typeof getResendClient>;
  try {
    resend = getResendClient();
  } catch (error) {
    // The only failure here is the unset RESEND_API_KEY: a static message.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err: error }, "Failed to send email:");
    return false;
  }
  const payload = {
    from: resend.fromEmail,
    to: [to],
    subject,
    html,
    ...(options?.headers ? { headers: options.headers } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const outcome = await attemptSend(resend.client, payload, options?.idempotencyKey);
    if (outcome === "sent") return true;
    const delay = EMAIL_SEND_RETRY_DELAYS_MS[attempt];
    if (outcome === "failed" || delay === undefined) return false;
    await pause(delay);
  }
}

/**
 * The Idempotency-Key for one athlete's email of one kind on one local day.
 * Every scheduled email goes out at most once a day per athlete (its claim
 * sees to that), so the day is the window. Hashed, so the key carries no
 * account id and stays well inside Resend's 256-character limit.
 */
export function emailIdempotencyKey(kind: string, userId: string, localDate: string): string {
  const digest = createHash("sha256").update(`${userId}:${localDate}`).digest("hex").slice(0, 40);
  return `${kind}-${digest}`;
}

/**
 * Send to an athlete with the one-click unsubscribe headers every athlete
 * email must carry. False (no send) when the account has no address.
 */
export async function sendEmailToUser(
  user: User,
  subject: string,
  html: string,
  idempotencyKey?: string,
): Promise<boolean> {
  if (!user.email) return false;
  return await sendEmail(user.email, subject, html, {
    headers: buildListUnsubscribeHeaders(user.id),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

export async function sendWeeklySummary(
  user: User,
  data: WeeklySummaryData,
  localDate: string,
): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildWeeklySummaryEmail(user, data);
  return await sendEmailToUser(user, subject, html, emailIdempotencyKey("weekly-summary", user.id, localDate));
}

export async function sendMissedWorkoutReminder(
  user: User,
  missed: MissedWorkoutData[],
  localDate: string,
): Promise<boolean> {
  if (!user.email || missed.length === 0) return false;
  const { subject, html } = buildMissedWorkoutEmail(user, missed);
  return await sendEmailToUser(user, subject, html, emailIdempotencyKey("missed-reminder", user.id, localDate));
}

export async function sendMafTestReminder(user: User, localDate: string): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildMafTestReminderEmail(user);
  return await sendEmailToUser(user, subject, html, emailIdempotencyKey("maf-test-reminder", user.id, localDate));
}

export async function sendWeeklyReviewReminder(
  user: User,
  data: WeeklyReviewReminderData,
  localDate: string,
): Promise<boolean> {
  if (!user.email) return false;
  const { subject, html } = buildWeeklyReviewReminderEmail(user, data);
  return await sendEmailToUser(user, subject, html, emailIdempotencyKey("weekly-review-reminder", user.id, localDate));
}

export async function sendTodaySessionBrief(
  user: User,
  data: TodaySessionData,
  localDate: string,
): Promise<boolean> {
  if (!user.email || data.sessions.length === 0) return false;
  const { subject, html } = buildTodaySessionEmail(user, data);
  return await sendEmailToUser(user, subject, html, emailIdempotencyKey("today-session", user.id, localDate));
}

export async function sendAnalysisDigest(
  user: User,
  data: AnalysisDigestData,
  localDate: string,
): Promise<boolean> {
  if (!user.email) return false;
  if (!data.racePrediction && !data.coachInsightsMarkdown) return false;
  const { subject, html } = buildAnalysisDigestEmail(user, data);
  return await sendEmailToUser(user, subject, html, emailIdempotencyKey("analysis-digest", user.id, localDate));
}
