import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("../../db", () => ({
  db: { select: selectMock },
}));

import { AnalyticsStorage } from "../analytics";

// One thenable chain per db.select(): the missed-days query, and the nested
// NOT EXISTS absence subquery built as an argument to .where().
function chain(resolvedValue: unknown) {
  const promise = Promise.resolve(resolvedValue) as Promise<unknown> & Record<string, unknown>;
  promise.from = vi.fn().mockReturnValue(promise);
  promise.innerJoin = vi.fn().mockReturnValue(promise);
  promise.where = vi.fn().mockReturnValue(promise);
  return promise;
}

function row(id: string, focus: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    scheduledDate: "2026-09-22",
    focus,
    mainWorkout: `${focus} workout`,
    priority: null,
    recovery: null,
    planName: "Build",
    ...overrides,
  };
}

describe("AnalyticsStorage.getMissedWorkoutsForDate", () => {
  const storage = new AnalyticsStorage();

  beforeEach(() => {
    selectMock.mockReset();
  });

  it("reminds about the sessions worth recovering, and nothing the athlete need not be chased for", async () => {
    selectMock
      .mockReturnValueOnce(
        chain([
          row("key", "Threshold run"),
          row("supporting", "Strength B"),
          row("optional-inferred", "Easy run"),
          row("optional-marked", "Strength C", { priority: "optional" }),
          row("marked-key", "Easy run", { priority: "key" }),
          row("let-go", "Intervals", { recovery: "let_go" }),
          row("rest", "Rest", { mainWorkout: "Complete rest or light walk" }),
        ]),
      )
      .mockReturnValueOnce(chain([]));

    const missed = await storage.getMissedWorkoutsForDate("user-1", "2026-09-22");

    expect(missed.map((day) => day.planDayId)).toEqual(["key", "supporting", "marked-key"]);
    expect(missed[0]).toEqual({
      planDayId: "key",
      date: "2026-09-22",
      focus: "Threshold run",
      mainWorkout: "Threshold run workout",
      planName: "Build",
    });
  });
});
