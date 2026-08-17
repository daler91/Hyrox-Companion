import { planDays, timelineAnnotations, trainingPlans, users } from "@shared/schema";
import { and, eq, exists, gte, inArray, lt, lte, notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

/**
 * The declared-absence guards render as *correlated* NOT EXISTS.
 *
 * The rest of this suite mocks `db`, which means it proves the guard was passed
 * to `.where()` but nothing at all about the SQL that guard becomes — and an
 * uncorrelated subquery here fails in the worst possible direction: one
 * annotation anywhere in the table would stop the sweep marking *anybody's*
 * days missed, silently, with no error to notice. There is no database in CI to
 * catch that, so the rendered statement is asserted directly.
 *
 * The queries are rebuilt here rather than imported because both are inlined in
 * `.where()` calls on a mocked `db`. They are kept character-identical to the
 * originals in plans.ts / analytics.ts.
 */

// Driverless: building a query AST needs no connection.
const db = drizzle({ client: { query: async () => ({ rows: [] }) } as never });
const dialect = new PgDialect();

function render(query: { getSQL: () => never }): string {
  return dialect.sqlToQuery(query.getSQL()).sql;
}

describe("declared-absence guards", () => {
  it("correlates the missed-day sweep's NOT EXISTS to each plan day's own owner and date", () => {
    const zonePlanIds = db
      .select({ id: trainingPlans.id })
      .from(trainingPlans)
      .innerJoin(users, eq(users.id, trainingPlans.userId))
      .where(eq(users.userTimezone, "UTC"));

    const rendered = render(
      db
        .update(planDays)
        .set({ status: "missed" })
        .where(
          and(
            eq(planDays.status, "planned"),
            lt(planDays.scheduledDate, "2026-07-21"),
            inArray(planDays.planId, zonePlanIds),
            notExists(
              db
                .select({ one: sql`1` })
                .from(timelineAnnotations)
                .innerJoin(trainingPlans, eq(trainingPlans.id, planDays.planId))
                .where(
                  and(
                    eq(timelineAnnotations.userId, trainingPlans.userId),
                    lte(timelineAnnotations.startDate, planDays.scheduledDate),
                    gte(timelineAnnotations.endDate, planDays.scheduledDate),
                  ),
                ),
            ),
          ),
        ) as never,
    );

    expect(rendered).toContain("not exists");
    // The owner is reached through the plan, since plan_days has no user_id.
    expect(rendered).toContain(`"timeline_annotations"."user_id" = "training_plans"."user_id"`);
    // Correlated on the OUTER plan_days row — this is the assertion that
    // an uncorrelated rewrite would break.
    expect(rendered).toContain(
      `"timeline_annotations"."start_date" <= "plan_days"."scheduled_date"`,
    );
    expect(rendered).toContain(
      `"timeline_annotations"."end_date" >= "plan_days"."scheduled_date"`,
    );
  });

  it("scopes the missed-reminder's NOT EXISTS to the one user and date being checked", () => {
    const userId = "user-1";
    const date = "2026-07-20";

    const query = db
      .select({ id: planDays.id })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          eq(planDays.scheduledDate, date),
          eq(planDays.status, "missed"),
          notExists(
            db
              .select({ one: sql`1` })
              .from(timelineAnnotations)
              .where(
                and(
                  eq(timelineAnnotations.userId, userId),
                  lte(timelineAnnotations.startDate, date),
                  gte(timelineAnnotations.endDate, date),
                ),
              ),
          ),
        ),
      );

    expect(render(query as never)).toContain("not exists");
    // Bound parameters, not a cross-user correlation: the reminder already
    // knows whose day it is asking about.
    expect(dialect.sqlToQuery(query.getSQL()).params).toEqual(
      expect.arrayContaining([userId, date, "missed", userId, date, date]),
    );
  });

  it("correlates the weekly email's excused count to each plan day's own date", () => {
    // getWeeklyStats' excused split (analytics.ts). Positive EXISTS this time:
    // an uncorrelated version would excuse every day of everyone's week off a
    // single annotation anywhere, silently deflating missed counts to zero.
    const userId = "user-1";

    const query = db
      .select({
        status: planDays.status,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          sql`${planDays.scheduledDate} >= ${"2026-07-13"}`,
          sql`${planDays.scheduledDate} <= ${"2026-07-19"}`,
          inArray(planDays.status, ["planned", "missed"]),
          exists(
            db
              .select({ one: sql`1` })
              .from(timelineAnnotations)
              .where(
                and(
                  eq(timelineAnnotations.userId, userId),
                  lte(timelineAnnotations.startDate, planDays.scheduledDate),
                  gte(timelineAnnotations.endDate, planDays.scheduledDate),
                ),
              ),
          ),
        ),
      )
      .groupBy(planDays.status);

    const rendered = render(query as never);
    expect(rendered).toContain("exists");
    // Correlated on the OUTER plan_days row's own date, per day.
    expect(rendered).toContain(
      `"timeline_annotations"."start_date" <= "plan_days"."scheduled_date"`,
    );
    expect(rendered).toContain(
      `"timeline_annotations"."end_date" >= "plan_days"."scheduled_date"`,
    );
  });
});
