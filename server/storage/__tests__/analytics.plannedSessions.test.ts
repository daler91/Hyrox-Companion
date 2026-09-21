import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("../../db", () => ({
  db: { select: selectMock },
}));

import { AnalyticsStorage } from "../analytics";

// One thenable chain per db.select(): the outer planned-days query, and the
// nested NOT EXISTS absence subquery that noAbsenceDeclaredForUserDate builds
// as an argument to .where() (never awaited on its own).
function chain(resolvedValue: unknown) {
  const promise = Promise.resolve(resolvedValue) as Promise<unknown> & Record<string, unknown>;
  promise.from = vi.fn().mockReturnValue(promise);
  promise.innerJoin = vi.fn().mockReturnValue(promise);
  promise.where = vi.fn().mockReturnValue(promise);
  promise.orderBy = vi.fn().mockReturnValue(promise);
  return promise;
}

describe("AnalyticsStorage.getPlannedSessionsForDate", () => {
  const storage = new AnalyticsStorage();

  beforeEach(() => {
    selectMock.mockReset();
  });

  it("maps the joined rows into the session-brief shape, nulling absent fields", async () => {
    const outer = chain([
      {
        id: "pd-1",
        focus: "Threshold intervals",
        mainWorkout: "6x800m",
        expectedDurationMin: 55,
        expectedRpe: 7,
        plannedTimeOfDayMin: 390,
        planName: "12-week build",
      },
      {
        id: "pd-2",
        focus: "Easy run",
        mainWorkout: "40 min Z2",
        expectedDurationMin: null,
        expectedRpe: undefined,
        plannedTimeOfDayMin: null,
        planName: null,
      },
    ]);
    selectMock.mockReturnValueOnce(outer).mockReturnValueOnce(chain([]));

    const sessions = await storage.getPlannedSessionsForDate("user-1", "2026-07-21");

    expect(sessions).toEqual([
      {
        planDayId: "pd-1",
        focus: "Threshold intervals",
        mainWorkout: "6x800m",
        expectedDurationMin: 55,
        expectedRpe: 7,
        plannedTimeOfDayMin: 390,
        planName: "12-week build",
      },
      {
        planDayId: "pd-2",
        focus: "Easy run",
        mainWorkout: "40 min Z2",
        expectedDurationMin: null,
        expectedRpe: null,
        plannedTimeOfDayMin: null,
        planName: null,
      },
    ]);
    // Scoped in SQL (join + where + order), and the absence guard's nested
    // subquery was built — the second db.select() — rather than filtered in memory.
    expect(outer.innerJoin).toHaveBeenCalledTimes(1);
    expect(outer.where).toHaveBeenCalledTimes(1);
    expect(outer.orderBy).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list for a day with nothing planned", async () => {
    selectMock.mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([]));

    await expect(storage.getPlannedSessionsForDate("user-1", "2026-07-21")).resolves.toEqual([]);
  });
});
