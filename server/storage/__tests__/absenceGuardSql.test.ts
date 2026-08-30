import { planDays, timelineAnnotations, trainingPlans, users } from "@shared/schema";
import { and, eq, exists, gte, inArray, lt, lte, notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { missedSweepRetirementGuard, planDayWithinPlanLifetime, planLiveForDate } from "../planRetirement";

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

/**
 * The missed-day sweep's statement, built once and rendered by every test that
 * asserts something about it.
 *
 * Both of its guards — declared absence and plan retirement — live on the same
 * WHERE, and each is a correlated NOT EXISTS that the other could plausibly
 * break: an unaliased retirement guard would shadow the training_plans the
 * absence guard joins for its own purposes. Restating the statement per test
 * meant a fix could be applied to one copy and asserted against the other, so
 * it is written out once here, kept character-identical to the original in
 * plans.ts, and every test below renders THIS.
 */
function renderMissedSweep(today = "2026-07-21", timezone = "UTC"): string {
  const zonePlanIds = db
    .select({ id: trainingPlans.id })
    .from(trainingPlans)
    .innerJoin(users, eq(users.id, trainingPlans.userId))
    .where(eq(users.userTimezone, timezone));

  return render(
    db
      .update(planDays)
      .set({ status: "missed" })
      .where(
        and(
          eq(planDays.status, "planned"),
          lt(planDays.scheduledDate, today),
          inArray(planDays.planId, zonePlanIds),
          // The REAL guard, imported rather than restated — a predicate asserted
          // against a hand-copied twin of itself proves nothing about the query
          // that actually runs.
          missedSweepRetirementGuard(db),
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
}

describe("declared-absence guards", () => {
  it("correlates the missed-day sweep's NOT EXISTS to each plan day's own owner and date", () => {
    const rendered = renderMissedSweep();

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

/**
 * The retirement guards, asserted the same way and for the same reason.
 *
 * These import the REAL predicate builders from ../planRetirement rather than
 * restating them, so the half-open `[start, retired_on)` convention is asserted
 * against the code the queries actually run. The absence guards above can only
 * duplicate their queries because those are inlined in `.where()` calls; the
 * retirement rule is shared across four call sites, which is precisely why it
 * had to be extracted, and why a copy here would defeat the point.
 */
describe("plan-retirement guards", () => {
  it("lets a retired plan answer only for the stretch it actually ran", () => {
    const date = "2026-07-20";
    const rendered = render(
      db
        .select()
        .from(trainingPlans)
        .where(and(eq(trainingPlans.userId, "user-1"), planLiveForDate(date))) as never,
    );

    expect(rendered).toContain(`"training_plans"."retired_on" IS NULL`);
    expect(rendered).toContain(`"training_plans"."retired_on" > $`);
    // The coverage half. Without it a plan archived before it ever started still
    // satisfies `retired_on > date` for every earlier date, and wins
    // getPlanForDate's "next upcoming" fallback — the bug in mirror image.
    expect(rendered).toContain(`"training_plans"."start_date" <= $`);
    expect(rendered).toContain(`"training_plans"."end_date" >= $`);
  });

  it("counts a plan day only while its own plan was still live", () => {
    const rendered = render(
      db
        .select({ count: sql<number>`count(*)` })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(and(eq(trainingPlans.userId, "user-1"), planDayWithinPlanLifetime())) as never,
    );

    // Half-open and correlated per day: strictly `<`, against the outer row's
    // own scheduled_date. A `<=` here would count the cutoff day itself and
    // silently disagree with planLiveForDate's `>`.
    expect(rendered).toContain(
      `"plan_days"."scheduled_date" < "training_plans"."retired_on"`,
    );
    expect(rendered).toContain(`"training_plans"."retired_on" IS NULL`);
  });

  it("keeps the sweep's retirement guard aliased and correlated, without disturbing the absence guard", () => {
    const rendered = renderMissedSweep();

    // Aliased, so the guard cannot be confused with the training_plans the
    // absence guard joins for its own purposes. Rewriting the outer UPDATE as
    // `UPDATE ... FROM training_plans` would put an unaliased copy in scope
    // that silently shadows that join — legal SQL, wrong results.
    expect(rendered).toContain(`"training_plans" "retired_plan"`);
    expect(rendered).toContain(`"retired_plan"."id" = "plan_days"."plan_id"`);
    // Correlated on the outer day: a partially retired plan must still have its
    // EARLIER days swept, so this cannot be decided at plan granularity.
    expect(rendered).toContain(
      `"plan_days"."scheduled_date" >= "retired_plan"."retired_on"`,
    );
    // Regression: the absence guard's own correlation survives alongside it.
    expect(rendered).toContain(
      `"timeline_annotations"."user_id" = "training_plans"."user_id"`,
    );
  });
});
