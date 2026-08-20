import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("../../db", () => ({
  db: { select: selectMock },
}));

import { AnalyticsStorage } from "../analytics";

// getWeeklyStats issues four sequential db.select() calls: the logged-session
// totals, the planned/missed/skipped counts by status, a nested EXISTS
// subquery (built but never awaited on its own — it's handed to `exists()`),
// and the excused-count query. Each gets its own thenable "chain" so the test
// can hand back different rows per call without threading one shared mock
// through every .from()/.innerJoin()/.where()/.groupBy().
function chain(resolvedValue: unknown) {
  const promise = Promise.resolve(resolvedValue) as Promise<unknown> & Record<string, unknown>;
  promise.from = vi.fn().mockReturnValue(promise);
  promise.innerJoin = vi.fn().mockReturnValue(promise);
  promise.where = vi.fn().mockReturnValue(promise);
  promise.groupBy = vi.fn().mockReturnValue(promise);
  return promise;
}

describe("AnalyticsStorage.getWeeklyStats", () => {
  const storage = new AnalyticsStorage();

  beforeEach(() => {
    selectMock.mockReset();
  });

  function mockQueries({
    logs = [{ completedCount: 0, totalDuration: 0 }],
    days = [] as { status: string; count: number }[],
    excusedRows = [] as { status: string; count: number }[],
  } = {}) {
    // Call order: the logs query, the days-by-status query, then the
    // excusedRows query itself — whose own .where() builds a nested EXISTS
    // subquery (a *fifth* db.select() invocation, evaluated as an argument
    // before .where() is called, but never awaited on its own).
    selectMock
      .mockReturnValueOnce(chain(logs))
      .mockReturnValueOnce(chain(days))
      .mockReturnValueOnce(chain(excusedRows))
      .mockReturnValueOnce(chain([])); // nested EXISTS subquery — never awaited directly
  }

  it("returns the logged sessions and total duration from the workout_logs query", async () => {
    mockQueries({ logs: [{ completedCount: 4, totalDuration: 240 }] });

    const result = await storage.getWeeklyStats("user-1", "2026-06-08", "2026-06-14");

    expect(result.completedCount).toBe(4);
    expect(result.totalDuration).toBe(240);
  });

  it("falls back to zero when the week has no logged sessions", async () => {
    mockQueries({ logs: [] });

    const result = await storage.getWeeklyStats("user-1", "2026-06-08", "2026-06-14");

    expect(result.completedCount).toBe(0);
    expect(result.totalDuration).toBe(0);
  });

  it("buckets the planned/missed/skipped counts by their status", async () => {
    mockQueries({
      days: [
        { status: "planned", count: 2 },
        { status: "missed", count: 1 },
        { status: "skipped", count: 3 },
      ],
    });

    const result = await storage.getWeeklyStats("user-1", "2026-06-08", "2026-06-14");

    expect(result.plannedCount).toBe(2);
    expect(result.missedCount).toBe(1);
    expect(result.skippedCount).toBe(3);
  });

  it("holds an excused day out of the missed count when the sweep already marked it missed", async () => {
    // The exact case the source comment warns about: a declared absence logged
    // after the sweep ran should not still read as "you missed a session".
    mockQueries({
      days: [
        { status: "missed", count: 2 },
        { status: "planned", count: 1 },
      ],
      excusedRows: [{ status: "missed", count: 2 }],
    });

    const result = await storage.getWeeklyStats("user-1", "2026-06-08", "2026-06-14");

    expect(result.missedCount).toBe(0);
    expect(result.excusedCount).toBe(2);
  });

  it("holds an excused day out of the planned count when the sweep ran after logging", async () => {
    mockQueries({
      days: [{ status: "planned", count: 3 }],
      excusedRows: [{ status: "planned", count: 1 }],
    });

    const result = await storage.getWeeklyStats("user-1", "2026-06-08", "2026-06-14");

    expect(result.plannedCount).toBe(2);
    expect(result.excusedCount).toBe(1);
  });

  it("sums excusedCount across both missed and planned excused rows", async () => {
    mockQueries({
      days: [
        { status: "missed", count: 2 },
        { status: "planned", count: 3 },
      ],
      excusedRows: [
        { status: "missed", count: 1 },
        { status: "planned", count: 1 },
      ],
    });

    const result = await storage.getWeeklyStats("user-1", "2026-06-08", "2026-06-14");

    expect(result.excusedCount).toBe(2);
    expect(result.missedCount).toBe(1);
    expect(result.plannedCount).toBe(2);
  });
});
