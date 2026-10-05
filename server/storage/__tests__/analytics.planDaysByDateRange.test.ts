import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("../../db", () => ({
  db: { select: selectMock },
}));

import { AnalyticsStorage } from "../analytics";

const dialect = new PgDialect();

function chain(resolvedValue: unknown) {
  const promise = Promise.resolve(resolvedValue) as Promise<unknown> & Record<string, unknown>;
  promise.from = vi.fn().mockReturnValue(promise);
  promise.innerJoin = vi.fn().mockReturnValue(promise);
  promise.where = vi.fn().mockReturnValue(promise);
  return promise;
}

/**
 * The weekly review's plan days. The `db` is mocked, so the WHERE the query
 * hands to `.where()` is rendered and read: a passing mock alone would say
 * nothing about which plan days the statement selects.
 */
describe("AnalyticsStorage.getPlanDaysByDateRange", () => {
  const storage = new AnalyticsStorage();

  beforeEach(() => {
    selectMock.mockReset();
  });

  // AI17 (CODEBASE_ANALYSIS_2026-10-03): a retired plan's days from its
  // cutoff on stay `planned` for good. Without the lifetime guard the review
  // counted them beside the new plan's sessions after a mid-week switch.
  it("keeps a retired plan's days from its cutoff onward out of the week", async () => {
    const query = chain([]);
    selectMock.mockReturnValueOnce(query);

    await storage.getPlanDaysByDateRange("user-1", "2026-06-08", "2026-06-14");

    const where = (query.where as ReturnType<typeof vi.fn>).mock.calls[0][0] as SQL;
    const rendered = dialect.sqlToQuery(where).sql;
    // Half-open per day, the rule the adherence counts and the timeline use.
    expect(rendered).toContain('"training_plans"."retired_on" IS NULL');
    expect(rendered).toContain('"plan_days"."scheduled_date" < "training_plans"."retired_on"');
    // Still scoped to the athlete and the week.
    expect(rendered).toContain('"training_plans"."user_id" = $');
    expect(rendered).toContain('"plan_days"."scheduled_date" >= $');
    expect(rendered).toContain('"plan_days"."scheduled_date" <= $');
  });

  it("maps the rows, defaulting a missing status to planned", async () => {
    selectMock.mockReturnValueOnce(
      chain([
        {
          id: "pd-1",
          scheduledDate: "2026-06-09",
          focus: "Threshold",
          mainWorkout: "6x800m",
          status: null,
          skipReason: null,
          priority: "key",
          recovery: null,
          planName: "Build",
        },
      ]),
    );

    expect(await storage.getPlanDaysByDateRange("user-1", "2026-06-08", "2026-06-14")).toEqual([
      {
        id: "pd-1",
        date: "2026-06-09",
        focus: "Threshold",
        mainWorkout: "6x800m",
        status: "planned",
        skipReason: null,
        priority: "key",
        recovery: null,
        planName: "Build",
      },
    ]);
  });
});
