import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared Resend mock. Hoisted so the vi.mock factory below can reference it —
// vi.mock factories run before top-level consts are evaluated, so a plain
// `const sendMock` would be undefined when the factory runs.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: sendMock } };
  }),
}));

// Mutable env mock so individual tests can toggle RESEND_API_KEY /
// RESEND_FROM_EMAIL without touching process.env or the real zod-validated
// env module.
vi.mock("./env", () => ({
  env: {
    RESEND_API_KEY: "test_key",
    RESEND_FROM_EMAIL: undefined,
    APP_URL: undefined,
    // The unsubscribe token in every footer/header is an HMAC keyed off this.
    ENCRYPTION_KEY: "0".repeat(32),
    ENCRYPTION_KEY_V2: undefined,
  },
}));

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { createMockMissedWorkout, createMockUser, createMockWeeklySummary } from "../test/factories";
import {
  EMAIL_SEND_RETRY_DELAYS_MS,
  emailIdempotencyKey,
  sendAnalysisDigest,
  sendEmail,
  sendMissedWorkoutReminder,
  sendTodaySessionBrief,
  sendWeeklyReviewReminder,
  sendWeeklySummary,
} from "./email";
import { env } from "./env";
import { logger } from "./logger";

describe("email sending", () => {
  const baseUser = createMockUser({ id: "user_1", email: "test@example.com", aiCoachEnabled: true });

  const weeklyData = createMockWeeklySummary();
  /** The athlete's local date each scheduled email's idempotency key is made from. */
  const DAY = "2026-07-21";
  const missedWorkouts = [createMockMissedWorkout()];

  beforeEach(() => {
    vi.clearAllMocks();
    env.RESEND_API_KEY = "test_key";
    env.RESEND_FROM_EMAIL = undefined;
    // Default happy-path Resend response.
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });
  });

  describe("sendEmail", () => {
    it("calls Resend emails.send with the correct payload", async () => {
      const result = await sendEmail(
        "to@example.com",
        "Subject",
        "<p>Hello</p>",
      );

      expect(result).toBe(true);
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith({
        from: "fitai.coach <Timmy@fitai.coach>",
        to: ["to@example.com"],
        subject: "Subject",
        html: "<p>Hello</p>",
      });
    });

    it("forwards custom headers to Resend when given", async () => {
      await sendEmail("to@example.com", "Subject", "<p>Hello</p>", {
        headers: { "List-Unsubscribe": "<https://example.com/u>" },
      });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { "List-Unsubscribe": "<https://example.com/u>" } }),
      );
    });

    it("returns true when Resend resolves with no error", async () => {
      sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });
      const result = await sendEmail("to@example.com", "s", "h");
      expect(result).toBe(true);
    });

    it("returns false and logs when Resend responds with an error object", async () => {
      const resendError = {
        name: "validation_error",
        message: "Invalid `to` field",
      };
      sendMock.mockResolvedValue({ data: null, error: resendError });

      const result = await sendEmail("to@example.com", "s", "h");

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        { err: resendError },
        "Resend error:",
      );
    });

    it("returns false and logs when Resend emails.send keeps throwing", async () => {
      vi.useFakeTimers();
      const boom = new Error("network down");
      sendMock.mockRejectedValue(boom);

      const pending = sendEmail("to@example.com", "s", "h");
      await vi.runAllTimersAsync();
      const result = await pending;
      vi.useRealTimers();

      expect(result).toBe(false);
      expect(sendMock).toHaveBeenCalledTimes(1 + EMAIL_SEND_RETRY_DELAYS_MS.length);
      expect(logger.error).toHaveBeenCalledWith(
        { err: boom },
        "Failed to send email:",
      );
    });

    // Tech debt #39: the send's claim is taken before it, and the job is
    // never retried, so one failed attempt used to cost that window's email.
    describe("retries (tech debt #39)", () => {
      async function settle<T>(pending: Promise<T>): Promise<T> {
        await vi.runAllTimersAsync();
        return await pending;
      }

      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("tries again after a failure that may pass, and reports the send that then works", async () => {
        sendMock
          .mockResolvedValueOnce({ data: null, error: { name: "internal_server_error", message: "boom", statusCode: 500 } })
          .mockRejectedValueOnce(new Error("socket hang up"))
          .mockResolvedValueOnce({ data: { id: "msg_1" }, error: null });

        expect(await settle(sendEmail("to@example.com", "s", "h"))).toBe(true);
        expect(sendMock).toHaveBeenCalledTimes(3);
      });

      it("does not try again after a failure that will not pass", async () => {
        sendMock.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad to", statusCode: 422 } });

        expect(await settle(sendEmail("to@example.com", "s", "h"))).toBe(false);
        expect(sendMock).toHaveBeenCalledTimes(1);
      });

      it("sends every attempt under the same idempotency key", async () => {
        sendMock
          .mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", message: "slow down", statusCode: 429 } })
          .mockResolvedValueOnce({ data: { id: "msg_1" }, error: null });

        await settle(sendEmail("to@example.com", "s", "h", { idempotencyKey: "key-1" }));

        expect(sendMock.mock.calls.map((call) => call[1])).toEqual([
          { idempotencyKey: "key-1" },
          { idempotencyKey: "key-1" },
        ]);
      });
    });

    it("returns false and logs when RESEND_API_KEY is not set", async () => {
      env.RESEND_API_KEY = undefined;

      const result = await sendEmail("to@example.com", "s", "h");

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({
            message: "RESEND_API_KEY environment variable is not set",
          }),
        }),
        "Failed to send email:",
      );
    });

    it("uses RESEND_FROM_EMAIL when set", async () => {
      env.RESEND_FROM_EMAIL = "Custom Sender <custom@example.com>";

      await sendEmail("to@example.com", "s", "h");

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Custom Sender <custom@example.com>",
        }),
      );
    });

    it("falls back to the default from email when RESEND_FROM_EMAIL is unset", async () => {
      env.RESEND_FROM_EMAIL = undefined;

      await sendEmail("to@example.com", "s", "h");

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "fitai.coach <Timmy@fitai.coach>",
        }),
      );
    });
  });

  describe("sendWeeklySummary", () => {
    it("returns false without calling Resend when user.email is null", async () => {
      const result = await sendWeeklySummary(
        { ...baseUser, email: null },
        weeklyData,
        DAY,
      );

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("calls Resend with the subject and html built from buildWeeklySummaryEmail", async () => {
      const result = await sendWeeklySummary(baseUser, weeklyData, DAY);

      expect(result).toBe(true);
      expect(sendMock).toHaveBeenCalledTimes(1);
      const payload = sendMock.mock.calls[0][0];
      expect(payload.to).toEqual(["test@example.com"]);
      expect(payload.subject).toBe(
        "Your Week in Review: 3 workouts completed",
      );
      expect(payload.html).toContain("Hey John");
      expect(payload.html).toContain("Weekly Training Summary");
    });

    it("attaches the one-click unsubscribe headers and footer link", async () => {
      await sendWeeklySummary(baseUser, weeklyData, DAY);

      const payload = sendMock.mock.calls[0][0];
      expect(payload.headers["List-Unsubscribe"]).toContain("/api/v1/emails/unsubscribe?token=");
      expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(payload.html).toContain("/api/v1/emails/unsubscribe?token=");
    });

    it("propagates false when Resend responds with an error", async () => {
      sendMock.mockResolvedValue({
        data: null,
        error: { message: "boom" },
      });
      const result = await sendWeeklySummary(baseUser, weeklyData, DAY);
      expect(result).toBe(false);
    });
  });

  describe("newer digest wrappers", () => {
    const reviewData = {
      weekStart: "2026-07-13", weekEnd: "2026-07-19", weeklyGoal: 4, sessionsLogged: 2, sessionsPlanned: 0,
      plannedCompleted: 0, missed: 0, totalDurationMin: 90, avgRpe: null, personalRecords: [], previousIntent: null,
    };
    const briefData = {
      date: "2026-07-21", isTomorrow: false,
      sessions: [{ planDayId: "pd-1", focus: "Easy run", mainWorkout: "40 min", expectedDurationMin: 40, expectedRpe: 4, plannedTimeOfDayMin: null, planName: null }],
    };
    const digestData = { racePrediction: null, coachInsightsMarkdown: "**Focus** — run more", coachInsightsGeneratedAt: null };

    it("return false without calling Resend when user.email is null", async () => {
      const user = { ...baseUser, email: null };
      expect(await sendWeeklyReviewReminder(user, reviewData, DAY)).toBe(false);
      expect(await sendTodaySessionBrief(user, briefData, DAY)).toBe(false);
      expect(await sendAnalysisDigest(user, digestData, DAY)).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("skip an empty brief and an empty digest", async () => {
      expect(await sendTodaySessionBrief(baseUser, { ...briefData, sessions: [] }, DAY)).toBe(false);
      expect(await sendAnalysisDigest(baseUser, { racePrediction: null, coachInsightsMarkdown: null, coachInsightsGeneratedAt: null }, DAY)).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("send each template with the unsubscribe headers", async () => {
      expect(await sendWeeklyReviewReminder(baseUser, reviewData, DAY)).toBe(true);
      expect(await sendTodaySessionBrief(baseUser, briefData, DAY)).toBe(true);
      expect(await sendAnalysisDigest(baseUser, digestData, DAY)).toBe(true);

      expect(sendMock).toHaveBeenCalledTimes(3);
      const subjects = sendMock.mock.calls.map((call) => call[0].subject);
      expect(subjects).toEqual([
        "Your week is wrapping up — 2 sessions so far",
        "Today: Easy run",
        "Your coach insights are ready",
      ]);
      for (const [payload] of sendMock.mock.calls) {
        expect(payload.to).toEqual(["test@example.com"]);
        expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      }
    });
  });

  // Tech debt #39: each scheduled email carries a key Resend deduplicates on
  // for 24 hours, so a retried send cannot arrive twice.
  describe("idempotency keys", () => {
    it("send each scheduled email under a key for its kind, athlete and day", async () => {
      await sendWeeklySummary(baseUser, weeklyData, DAY);

      expect(sendMock).toHaveBeenCalledWith(expect.anything(), {
        idempotencyKey: emailIdempotencyKey("weekly-summary", baseUser.id, DAY),
      });
    });

    it("tell kinds, athletes and days apart, without carrying the account id", () => {
      const key = emailIdempotencyKey("weekly-summary", "user_1", DAY);

      expect(key).toMatch(/^weekly-summary-[0-9a-f]{40}$/);
      expect(key).not.toContain("user_1");
      expect(emailIdempotencyKey("weekly-summary", "user_1", DAY)).toBe(key);
      expect(emailIdempotencyKey("today-session", "user_1", DAY)).not.toBe(key);
      expect(emailIdempotencyKey("weekly-summary", "user_2", DAY)).not.toBe(key);
      expect(emailIdempotencyKey("weekly-summary", "user_1", "2026-07-22")).not.toBe(key);
    });
  });

  describe("sendMissedWorkoutReminder", () => {
    it("returns false without calling Resend when user.email is null", async () => {
      const result = await sendMissedWorkoutReminder(
        { ...baseUser, email: null },
        missedWorkouts,
        DAY,
      );

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("returns false without calling Resend when missed array is empty", async () => {
      const result = await sendMissedWorkoutReminder(baseUser, [], DAY);

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("calls Resend with the subject and html built from buildMissedWorkoutEmail", async () => {
      const result = await sendMissedWorkoutReminder(baseUser, missedWorkouts, DAY);

      expect(result).toBe(true);
      expect(sendMock).toHaveBeenCalledTimes(1);
      const payload = sendMock.mock.calls[0][0];
      expect(payload.to).toEqual(["test@example.com"]);
      expect(payload.subject).toBe("1 missed workout — get back on track");
      expect(payload.html).toContain("Strength");
      expect(payload.html).toContain("Squats, Deadlifts, Bench");
      expect(payload.html).toContain("Oct 3");
    });

    it("propagates false when Resend responds with an error", async () => {
      sendMock.mockResolvedValue({
        data: null,
        error: { message: "boom" },
      });
      const result = await sendMissedWorkoutReminder(baseUser, missedWorkouts, DAY);
      expect(result).toBe(false);
    });
  });
});
