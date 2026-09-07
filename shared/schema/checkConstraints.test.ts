import { sql } from "drizzle-orm";
import { getTableConfig,PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { MEAL_TYPES, planDaySkipReasonEnum, workoutStatusEnum } from "./enums";
import { FOOD_SOURCES, foodLogEntries, foods, inValues, mealTargets, planDays } from "./tables";

/**
 * Five CHECK constraints enumerate values that also exist as TypeScript
 * constants. They used to hold a hand-copied second list — the copy in
 * `foods_source_check` was dropped and re-added across migrations 0069-0071
 * chasing the TS side — so they are now rendered from the constant itself.
 *
 * These assertions pin the rendered DDL to the exact text that is deployed.
 * Two things break them, both deliberately:
 *
 *  - Adding or removing a value in one of the constants. That is a real schema
 *    change: write the migration, then update the expectation here. The point
 *    of the test is that this can no longer happen silently on only one side.
 *  - Reformatting the rendered list. Whitespace inside a CHECK expression is a
 *    diff to drizzle-kit, so a cosmetic change would otherwise generate a
 *    surprise constraint drop/recreate on push.
 */

const dialect = new PgDialect();

function checkSql(table: Parameters<typeof getTableConfig>[0], name: string): string {
  const found = getTableConfig(table).checks.find((c) => c.name === name);
  if (!found) throw new Error(`no CHECK named ${name} on this table`);
  return dialect.sqlToQuery(found.value).sql;
}

describe("enum-backed CHECK constraints", () => {
  it("renders plan_days.status from workoutStatusEnum", () => {
    expect(checkSql(planDays, "status_check")).toBe(
      "status IN ('planned', 'completed', 'missed', 'skipped')",
    );
    expect(workoutStatusEnum).toEqual(["planned", "completed", "missed", "skipped"]);
  });

  it("renders plan_days.skip_reason from planDaySkipReasonEnum", () => {
    expect(checkSql(planDays, "plan_days_skip_reason_check")).toBe(
      "skip_reason IS NULL OR skip_reason IN ('ill', 'injured', 'schedule', 'low_energy')",
    );
    expect(planDaySkipReasonEnum).toEqual(["ill", "injured", "schedule", "low_energy"]);
  });

  it("renders foods.source from FOOD_SOURCES", () => {
    expect(checkSql(foods, "foods_source_check")).toBe(
      "source IN ('usda', 'off', 'fatsecret', 'spoonacular', 'edamam', 'custom')",
    );
    // `fatsecret` and `spoonacular` have no client any more but stay legal:
    // narrowing a CHECK is a migration that fails on any surviving row.
    expect(FOOD_SOURCES).toContain("fatsecret");
    expect(FOOD_SOURCES).toContain("spoonacular");
  });

  it("renders both meal_type constraints from the one MEAL_TYPES constant", () => {
    // Two tables, one list — the pair that would most plausibly drift apart.
    const expected =
      "meal_type IN ('breakfast','lunch','dinner','snack','snack_pm','pre_workout','post_workout')";
    expect(checkSql(foodLogEntries, "food_log_entries_meal_type_check")).toBe(expected);
    expect(checkSql(mealTargets, "meal_targets_meal_type_check")).toBe(expected);
    expect(MEAL_TYPES).toHaveLength(7);
  });
});

describe("inValues", () => {
  it("renders whatever the constant holds, so the CHECK tracks it", () => {
    // The property that makes drift impossible: there is no second list to
    // update. Add a value to the constant and the DDL carries it.
    expect(dialect.sqlToQuery(sql`x IN (${inValues(["a", "b"])})`).sql).toBe("x IN ('a', 'b')");
    expect(dialect.sqlToQuery(sql`x IN (${inValues(["a", "b", "c"])})`).sql).toBe(
      "x IN ('a', 'b', 'c')",
    );
  });

  it("emits no bound parameters — the values are DDL text, not arguments", () => {
    expect(dialect.sqlToQuery(sql`x IN (${inValues(["a"])})`).params).toEqual([]);
  });

  it("refuses any value that is not a bare identifier", () => {
    // These lists are compile-time constants, and `sql.raw` is unavoidable for
    // DDL text, so the guard is what keeps that true.
    expect(() => inValues(["ok", "not'ok"])).toThrow(/unsafe CHECK constraint value/);
    expect(() => inValues(["Mixed-Case"])).toThrow(/unsafe CHECK constraint value/);
    expect(() => inValues(["a); drop table foods; --"])).toThrow(/unsafe CHECK constraint value/);
  });
});
