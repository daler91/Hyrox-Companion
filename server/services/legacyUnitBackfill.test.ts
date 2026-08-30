import { describe, expect, it } from "vitest";

import { stampUpdateFor, unstampedRowsOf } from "./legacyUnitBackfill";

/**
 * These read the SQL Drizzle would issue rather than executing it.
 *
 * Asserting on generated SQL is normally brittle, and it is used here for one
 * reason: `exercise_sets` has no user id, so the backfill scopes through a
 * `workout_logs` subquery, and if that scoping were ever dropped the statement
 * would still be valid SQL, still run without error, and stamp EVERY athlete's
 * rows with ONE athlete's unit. There is no assertion about returned data that
 * catches that — only an assertion about the statement itself.
 *
 * So they check structure, not exact text: that the user id is bound as a
 * parameter, that the NULL filter is present, and that the update targets one
 * column. Reformatting by a Drizzle upgrade should not fail them; losing the
 * scope should.
 */

const USER = "athlete-42";

function rendered(column: "weight" | "distance") {
  return stampUpdateFor(USER, column, column === "weight" ? "kg" : "m").toSQL();
}

describe("unstampedRowsOf — the scope that keeps one athlete's stamp on one athlete's rows", () => {
  it("binds the athlete as a parameter rather than matching everyone", () => {
    const { sql, params } = rendered("weight");

    expect(params).toContain(USER);
    // The subquery, not a bare table scan.
    expect(sql).toMatch(/in \(select/i);
    expect(sql).toMatch(/workout_logs/);
    expect(sql).toMatch(/user_id/);
  });

  it("only touches rows whose unit is still NULL", () => {
    // This is what makes the backfill idempotent AND what stops it overwriting
    // a post-migration row that already knows its own unit.
    expect(rendered("weight").sql).toMatch(/"weight_unit" is null/i);
    expect(rendered("distance").sql).toMatch(/"distance_unit" is null/i);
  });

  it("stamps the weight column without touching distance", () => {
    const { sql } = rendered("weight");
    const setClause = sql.slice(sql.search(/\bset\b/i), sql.search(/\bwhere\b/i));

    expect(setClause).toMatch(/weight_unit/);
    expect(setClause).not.toMatch(/distance_unit/);
  });

  it("stamps the distance column without touching weight", () => {
    const { sql } = rendered("distance");
    const setClause = sql.slice(sql.search(/\bset\b/i), sql.search(/\bwhere\b/i));

    expect(setClause).toMatch(/distance_unit/);
    expect(setClause).not.toMatch(/weight_unit/);
  });

  it("filters on the same column it stamps", () => {
    // A transposition here — stamping weight while filtering on distance NULL —
    // would silently skip rows that need it and re-stamp rows that do not.
    const weight = rendered("weight").sql;
    expect(weight).toMatch(/"weight_unit" is null/i);
    expect(weight).not.toMatch(/"distance_unit" is null/i);
  });

  it("produces a usable filter for both columns", () => {
    expect(unstampedRowsOf(USER, "weight")).toBeDefined();
    expect(unstampedRowsOf(USER, "distance")).toBeDefined();
  });

  it("is an UPDATE, not a DELETE — stated because the failure would be total", () => {
    expect(rendered("weight").sql).toMatch(/^update/i);
  });
});
