import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFY_HOUR,
  EMAIL_NOTIFY_KINDS,
  fallbackNotifyHour,
  isValidNotifyHour,
  NOTIFY_HOUR_FIELD,
  resolveNotifyHour,
} from "./notifyHours";
import { WEEKLY_REVIEW_SUNDAY_EVENING_HOUR } from "./weeklyReview";

describe("resolveNotifyHour", () => {
  it("uses an email's own hour when it has one", () => {
    expect(resolveNotifyHour({ notifyHour: 7, notifyHourTodaySession: 19 }, "todaySession")).toBe(19);
  });

  it("keeps midnight, which is a real hour rather than an absent one", () => {
    expect(resolveNotifyHour({ notifyHour: 7, notifyHourWeeklySummary: 0 }, "weeklySummary")).toBe(0);
  });

  it("falls back to the default send time for an email with no hour of its own", () => {
    expect(resolveNotifyHour({ notifyHour: 9 }, "weeklySummary")).toBe(9);
    expect(resolveNotifyHour({ notifyHour: 9, notifyHourMissedReminder: null }, "missedReminder")).toBe(9);
  });

  it("falls back to 07:00 when the athlete has no default send time either", () => {
    expect(resolveNotifyHour({}, "analysisDigest")).toBe(DEFAULT_NOTIFY_HOUR);
    expect(resolveNotifyHour({ notifyHour: null }, "analysisDigest")).toBe(DEFAULT_NOTIFY_HOUR);
  });

  it("leaves an unset review reminder on Sunday evening, not the default send time", () => {
    expect(resolveNotifyHour({ notifyHour: 7 }, "weeklyReviewReminder")).toBe(
      WEEKLY_REVIEW_SUNDAY_EVENING_HOUR,
    );
    expect(resolveNotifyHour({ notifyHour: 7, notifyHourWeeklyReviewReminder: 9 }, "weeklyReviewReminder")).toBe(9);
  });

  it("ignores a stored hour outside 0-23 rather than scheduling on it", () => {
    expect(resolveNotifyHour({ notifyHour: 7, notifyHourTodaySession: 24 }, "todaySession")).toBe(7);
    expect(resolveNotifyHour({ notifyHour: 99 }, "todaySession")).toBe(DEFAULT_NOTIFY_HOUR);
  });

  it("gives every email kind its own field and a usable fallback", () => {
    const fields = EMAIL_NOTIFY_KINDS.map((kind) => NOTIFY_HOUR_FIELD[kind]);
    expect(new Set(fields).size).toBe(EMAIL_NOTIFY_KINDS.length);
    for (const kind of EMAIL_NOTIFY_KINDS) {
      expect(isValidNotifyHour(fallbackNotifyHour(kind, 7))).toBe(true);
    }
  });
});

describe("isValidNotifyHour", () => {
  it("accepts whole hours of the day and nothing else", () => {
    expect(isValidNotifyHour(0)).toBe(true);
    expect(isValidNotifyHour(23)).toBe(true);
    expect(isValidNotifyHour(-1)).toBe(false);
    expect(isValidNotifyHour(24)).toBe(false);
    expect(isValidNotifyHour(7.5)).toBe(false);
    expect(isValidNotifyHour(null)).toBe(false);
    expect(isValidNotifyHour("7")).toBe(false);
  });
});
