import { describe, expect, it } from "vitest";

import { takeMostRecentSessions } from "../shared";

function row(id: string, date: string) {
  return { id, date };
}

// Rows arrive newest-date-first from queryExerciseSetsWithDates.
const HISTORY = [
  row("a1", "2026-06-10"),
  row("a2", "2026-06-10"),
  row("b1", "2026-06-03"),
  row("c1", "2026-05-27"),
  row("c2", "2026-05-27"),
  row("d1", "2026-05-20"),
];

describe("takeMostRecentSessions", () => {
  it("bounds sessions, not rows — a session's sets are never split", () => {
    // 2 sessions is 3 rows here, because the newest has two sets.
    expect(takeMostRecentSessions(HISTORY, 2).map((r) => r.id)).toEqual(["a1", "a2", "b1"]);
  });

  it("returns everything when there are fewer sessions than the bound", () => {
    expect(takeMostRecentSessions(HISTORY, 10)).toHaveLength(HISTORY.length);
  });

  it("returns everything when the bound is exactly the session count", () => {
    expect(takeMostRecentSessions(HISTORY, 4)).toHaveLength(HISTORY.length);
  });

  it("keeps one session whole", () => {
    expect(takeMostRecentSessions(HISTORY, 1).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("returns nothing for a non-positive bound", () => {
    expect(takeMostRecentSessions(HISTORY, 0)).toEqual([]);
    expect(takeMostRecentSessions(HISTORY, -1)).toEqual([]);
  });

  it("handles an empty history", () => {
    expect(takeMostRecentSessions([], 3)).toEqual([]);
  });
});
