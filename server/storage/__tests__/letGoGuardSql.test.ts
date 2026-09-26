import { planDays } from "@shared/schema";
import { not } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { planDayLetGo } from "../letGoGuard";

// Driverless: building a query AST needs no connection.
const db = drizzle({ client: { query: async () => ({ rows: [] }) } as never });
const dialect = new PgDialect();

/**
 * The let-go predicate as the adherence denominator uses it (NOT let go). The
 * rest of the suite mocks `db`, so only the rendered statement shows whether
 * an undecided day — recovery NULL — survives the NOT: with a bare
 * `recovery = 'let_go'` it renders NOT (… AND NULL), which is NULL, and every
 * ordinary miss silently drops out of "Avg Adherence".
 */
describe("planDayLetGo", () => {
  it("never compares a nullable column bare, so NOT of it is never NULL", () => {
    const rendered = dialect.sqlToQuery(
      db.select({ id: planDays.id }).from(planDays).where(not(planDayLetGo())).getSQL(),
    ).sql;

    expect(rendered).toContain(`not (coalesce("plan_days"."status", '') = 'missed' and coalesce("plan_days"."recovery", '') = 'let_go')`);
  });
});
