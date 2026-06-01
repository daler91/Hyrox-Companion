import { describe, expect, it } from "vitest";

import { formatScheduledDate } from "./timelineEntryFormat";

describe("formatScheduledDate", () => {
  it("formats a valid date string correctly", () => {
    // 2023-10-25 was a Wednesday
    expect(formatScheduledDate("2023-10-25")).toBe("Wednesday, Oct 25");
  });

  it("returns the raw string if parsing fails", () => {
    // Edge case: invalid string format should hit the catch block
    expect(formatScheduledDate("invalid-date")).toBe("invalid-date");
  });

  it("handles empty string by returning the empty string", () => {
    expect(formatScheduledDate("")).toBe("");
  });
});
