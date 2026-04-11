import type { User } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared Resend mock. Hoisted so the vi.mock factory below can reference it —
// vi.mock factories run before top-level consts are evaluated, so a plain
// `const sendMock` would be undefined when the factory runs.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

// Mutable env mock so individual tests can toggle RESEND_API_KEY /
// RESEND_FROM_EMAIL without touching process.env or the real zod-validated
// env module.
vi.mock("./env", () => ({
  env: {
    RESEND_API_KEY: "test_key",
    RESEND_FROM_EMAIL: undefined,
    APP_URL: undefined,
  },
}));

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  sendEmail,
  sendMissedWorkoutReminder,
  sendWeeklySummary,
} from "./email";
import type {
  MissedWorkoutData,
  WeeklySummaryData,
} from "./emailTemplates";
import { env } from "./env";
import { logger } from "./logger";

describe("email sending", () => {
  const baseUser: User = {
    id: "user_1",
    email: "test@example.com",
    firstName: "John",
    lastName: "Doe",
    profileImageUrl: null,
    weightUnit: "kg",
    distanceUnit: "km",
    weeklyGoal: 5,
    emailNotifications: true,
    aiCoachEnabled: true,
    isAutoCoaching: false,
    lastWeeklySummaryAt: null,
    lastMissedReminderAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const weeklyData: WeeklySummaryData = {
    completedCount: 3,
    plannedCount: 4,
    missedCount: 1,
    skippedCount: 0,
    completionRate: 75,
    currentStreak: 2,
    prsThisWeek: 1,
    totalDuration: 125,
    weekStartDate: "Oct 1",
    weekEndDate: "Oct 7",
  };

  const missedWorkouts: MissedWorkoutData[] = [
    {
      date: "Oct 3",
      focus: "Strength",
      mainWorkout: "Squats, Deadlifts, Bench",
      planName: "Hyrox Base",
    },
  ];

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

    it("returns false and logs when Resend emails.send throws", async () => {
      const boom = new Error("network down");
      sendMock.mockRejectedValue(boom);

      const result = await sendEmail("to@example.com", "s", "h");

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        { err: boom },
        "Failed to send email:",
      );
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
      );

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("calls Resend with the subject and html built from buildWeeklySummaryEmail", async () => {
      const result = await sendWeeklySummary(baseUser, weeklyData);

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

    it("propagates false when Resend responds with an error", async () => {
      sendMock.mockResolvedValue({
        data: null,
        error: { message: "boom" },
      });
      const result = await sendWeeklySummary(baseUser, weeklyData);
      expect(result).toBe(false);
    });
  });

  describe("sendMissedWorkoutReminder", () => {
    it("returns false without calling Resend when user.email is null", async () => {
      const result = await sendMissedWorkoutReminder(
        { ...baseUser, email: null },
        missedWorkouts,
      );

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("returns false without calling Resend when missed array is empty", async () => {
      const result = await sendMissedWorkoutReminder(baseUser, []);

      expect(result).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("calls Resend with the subject and html built from buildMissedWorkoutEmail", async () => {
      const result = await sendMissedWorkoutReminder(baseUser, missedWorkouts);

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
      const result = await sendMissedWorkoutReminder(baseUser, missedWorkouts);
      expect(result).toBe(false);
    });
  });
});
