import { describe, it, expect } from "vitest";
import { getStartOfWeek } from "./dateUtils";

describe("getStartOfWeek", () => {
  it("returns Sunday as the start of the week when weekStartsOn is 0", () => {
    // Wednesday, Feb 14, 2024
    const date = new Date(2024, 1, 14, 12, 0, 0);
    const result = getStartOfWeek(date, 0);

    // Should be Sunday, Feb 11, 2024
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(1); // 0-indexed, so 1 is Feb
    expect(result.getDate()).toBe(11);
    expect(result.getDay()).toBe(0); // 0 is Sunday

    // Time should be reset to 00:00:00.000 in local time, which depends on the system timezone
    // The safest check is comparing to a known Date object created without a time component
    // or by checking local time components.
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("returns Monday as the start of the week when weekStartsOn is 1", () => {
    // Wednesday, Feb 14, 2024
    const date = new Date(2024, 1, 14, 12, 0, 0);
    const result = getStartOfWeek(date, 1);

    // Should be Monday, Feb 12, 2024
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(12);
    expect(result.getDay()).toBe(1); // 1 is Monday

    expect(result.getHours()).toBe(0);
  });

  it("handles Sunday correctly when weekStartsOn is 0", () => {
    // Sunday, Feb 11, 2024
    const date = new Date(2024, 1, 11, 12, 0, 0);
    const result = getStartOfWeek(date, 0);

    expect(result.getDate()).toBe(11);
    expect(result.getDay()).toBe(0);
  });

  it("handles Sunday correctly when weekStartsOn is 1", () => {
    // Sunday, Feb 11, 2024 - should return previous Monday (Feb 5)
    // Note: new Date("2024-02-11T12:00:00") without Z to ensure local timezone
    const date = new Date(2024, 1, 11, 12, 0, 0);
    const result = getStartOfWeek(date, 1);

    expect(result.getDate()).toBe(5);
    expect(result.getDay()).toBe(1);
  });

  it("handles Monday correctly when weekStartsOn is 1", () => {
    // Monday, Feb 12, 2024
    const date = new Date(2024, 1, 12, 12, 0, 0);
    const result = getStartOfWeek(date, 1);

    expect(result.getDate()).toBe(12);
    expect(result.getDay()).toBe(1);
  });

  it("handles month boundaries correctly", () => {
    // Friday, March 1, 2024
    const date = new Date(2024, 2, 1, 12, 0, 0); // Month 2 is March
    const result = getStartOfWeek(date, 1); // Monday start

    // Should cross month boundary back to Monday, Feb 26, 2024 (Leap year)
    expect(result.getMonth()).toBe(1); // Feb
    expect(result.getDate()).toBe(26);
  });

  it("handles non-leap year February correctly", () => {
    // Wednesday, March 1, 2023
    const date = new Date(2023, 2, 1, 12, 0, 0);
    const result = getStartOfWeek(date, 1); // Monday start

    // Should cross month boundary back to Monday, Feb 27, 2023
    expect(result.getMonth()).toBe(1); // Feb
    expect(result.getDate()).toBe(27);
  });

  it("handles year boundaries correctly", () => {
    // Wednesday, Jan 3, 2024
    const date = new Date(2024, 0, 3, 12, 0, 0);
    const result = getStartOfWeek(date, 1); // Monday start

    // Should return Monday, Jan 1, 2024
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
  });

  it("handles crossing back to previous year correctly", () => {
    // Tuesday, Jan 2, 2024
    const date = new Date(2024, 0, 2, 12, 0, 0);
    const result = getStartOfWeek(date, 0); // Sunday start

    // Should return Sunday, Dec 31, 2023
    expect(result.getFullYear()).toBe(2023);
    expect(result.getMonth()).toBe(11); // Dec
    expect(result.getDate()).toBe(31);
  });

  it("handles no arguments by defaulting to current date and Sunday start", () => {
    const now = new Date();
    const result = getStartOfWeek();

    expect(result.getDay()).toBe(0); // Sunday
    expect(result.getHours()).toBe(0);
    // Can't reliably test exact date vs now() in a simple equality due to execution time,
    // but we can check if it's within the past 7 days.
    const diffTime = Math.abs(now.getTime() - result.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it("resets hours, minutes, seconds, and milliseconds", () => {
    const date = new Date(2024, 1, 14, 23, 59, 59, 999);
    const result = getStartOfWeek(date, 0);

    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});
