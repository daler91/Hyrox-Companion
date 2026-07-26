import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildLastPortionsQuery, buildVariantMatch, TRGM_SIMILARITY_THRESHOLD } from "./nutrition";

/**
 * SQL-shape regression test for the fuzzy food-search predicate. The routes and
 * orchestrator tests mock the storage layer, so this is the one place that pins
 * the WHERE fragment searchLocalFoods builds per query variant.
 *
 * The rule under guard: the fuzzy arms must use the pg_trgm `%` OPERATOR, which
 * gin_trgm_ops can serve (BitmapOr over idx_foods_name_trgm/idx_foods_brand_trgm
 * from migration 0074), never a `similarity(...) >= x` function predicate — that
 * shape is structurally unservable by the indexes and forces a sequential scan
 * of the whole shared foods table on every search.
 */
describe("buildVariantMatch", () => {
  const dialect = new PgDialect();

  it("fuzzy: matches by infix LIKE plus the index-servable % operator", () => {
    const rendered = dialect.sqlToQuery(buildVariantMatch("yoghrt", true));
    // Substring arms preserved (also GIN-accelerable for >=3-char needles)
    expect(rendered.sql).toContain(`lower("foods"."name") like `);
    expect(rendered.sql).toContain(`lower("foods"."brand") like `);
    // Trigram arms use the % operator against name and (non-null) brand
    expect(rendered.sql).toContain(`lower("foods"."name") % `);
    expect(rendered.sql).toContain(`"foods"."brand" is not null and lower("foods"."brand") % `);
    expect(rendered.params).toEqual(["%yoghrt%", "%yoghrt%", "yoghrt", "yoghrt"]);
  });

  it("fuzzy: never uses a similarity() function predicate in the WHERE", () => {
    const rendered = dialect.sqlToQuery(buildVariantMatch("yoghrt", true));
    expect(rendered.sql).not.toContain("similarity(");
  });

  it("non-fuzzy: LIKE arms only, no trigram operator", () => {
    const rendered = dialect.sqlToQuery(buildVariantMatch("yogurt", false));
    expect(rendered.sql).toContain(`like `);
    expect(rendered.sql).not.toContain(` % `);
    expect(rendered.params).toEqual(["%yogurt%", "%yogurt%"]);
  });

  it("escapes LIKE metacharacters but passes the raw variant to the % operator", () => {
    const rendered = dialect.sqlToQuery(buildVariantMatch("50% oats_x", true));
    expect(rendered.params).toEqual([
      "%50\\% oats\\_x%",
      "%50\\% oats\\_x%",
      "50% oats_x",
      "50% oats_x",
    ]);
  });

  it("pins the GUC coupling: % reads pg_trgm.similarity_threshold (default 0.3)", () => {
    // If a different threshold is ever wanted, the GUC must be SET per pooled
    // connection (the `%` operator reads it) and this constant updated with it.
    expect(TRGM_SIMILARITY_THRESHOLD).toBe(0.3);
  });
});

/**
 * The portion-memory lookup behind the favourites/recents lists. Both callers
 * mock storage, so this is the only place the DISTINCT ON shape is pinned.
 */
describe("buildLastPortionsQuery", () => {
  const dialect = new PgDialect();
  const rendered = () =>
    dialect.sqlToQuery(buildLastPortionsQuery("u1", ["f1", "f2"]).getSQL()).sql;

  it("takes one row per food via DISTINCT ON", () => {
    expect(rendered()).toContain(`distinct on ("food_log_entries"."food_id")`);
  });

  it("orders by the distinct key first, then newest-logged", () => {
    // Both terms matter: Postgres rejects a DISTINCT ON whose ORDER BY does not
    // lead with the distinct expression, and losing the DESC silently returns
    // the oldest portion instead of the most recent one.
    expect(rendered()).toContain(
      `order by "food_log_entries"."food_id", "food_log_entries"."logged_at" desc`,
    );
  });

  it("scopes to the owner as well as the requested foods", () => {
    const sql = rendered();
    expect(sql).toContain(`"food_log_entries"."user_id" = `);
    expect(sql).toContain(`"food_log_entries"."food_id" in `);
  });
});
