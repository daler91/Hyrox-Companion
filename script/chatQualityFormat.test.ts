import { describe, expect, it } from "vitest";

import { formatChatQualityReport, parseDays } from "./chatQualityFormat";

const PROPOSALS = { pending: 1, applied: 5, partlyApplied: 2, dismissed: 3, superseded: 0, invalidated: 1, reverted: 1 };

describe("the chat quality report", () => {
  it("counts an undone proposal as applied, and gives each outcome's share of what was drafted", () => {
    const report = formatChatQualityReport({ days: 30, proposals: PROPOSALS, feedback: { replies: 200, up: 8, down: 2 } });

    expect(report).toContain("the last 30 days");
    expect(report).toMatch(/Plan proposals drafted\s+11\n/);
    expect(report).toMatch(/applied \(all or some changes\)\s+6 \(55%\)/);
    expect(report).toMatch(/only some changes\s+2\n/);
    expect(report).toMatch(/undone afterwards\s+1 \(17%\)/);
    expect(report).toMatch(/dismissed\s+3 \(27%\)/);
    expect(report).toMatch(/out of date before applied\s+1 \(9%\)/);
    expect(report).toMatch(/rated\s+10 \(5%\)/);
    expect(report).toMatch(/helpful\s+8 \(80%\)/);
    expect(report).toMatch(/not helpful\s+2 \(20%\)/);
  });

  it("prints bare counts when there is nothing to divide by", () => {
    const empty = { pending: 0, applied: 0, partlyApplied: 0, dismissed: 0, superseded: 0, invalidated: 0, reverted: 0 };
    const report = formatChatQualityReport({ days: 1, proposals: empty, feedback: { replies: 0, up: 0, down: 0 } });

    expect(report).toContain("the last 1 day\n");
    expect(report).toMatch(/dismissed\s+0\n/);
    expect(report).not.toContain("NaN");
  });
});

describe("parseDays", () => {
  it("reads --days from 1 to 365, and falls back to 30", () => {
    expect(parseDays([])).toBe(30);
    expect(parseDays(["--days", "7"])).toBe(7);
    expect(parseDays(["--days", "0"])).toBe(30);
    expect(parseDays(["--days", "1000"])).toBe(30);
    expect(parseDays(["--days", "x"])).toBe(30);
    expect(parseDays(["--days"])).toBe(30);
  });
});
