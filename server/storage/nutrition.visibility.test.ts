import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { visibleTo } from "./nutrition";

/**
 * SQL-shape regression test for the food-visibility predicate. Every food
 * resolution and listing path (search, by-id, favorites, recents, semantic
 * re-check) funnels through visibleTo, and the routes tests mock the storage
 * layer — so this is the one place that pins the predicate itself.
 *
 * The rule under guard: custom-source foods are visible only to their owner or
 * when explicitly shared via is_public. The predicate must NEVER regress to
 * "NULL owner means shared" — the owner FK is set-null on account deletion, so
 * that rule leaked deleted users' private custom foods to everyone.
 */
describe("visibleTo", () => {
  const rendered = new PgDialect().sqlToQuery(visibleTo("user-1"));

  it("scopes custom foods to their owner or the explicit is_public opt-in", () => {
    expect(rendered.sql).toContain(`"created_by_user_id" = `);
    expect(rendered.sql).toContain(`"source" <> 'custom'`);
    expect(rendered.sql).toContain(`"is_public" = true`);
    expect(rendered.params).toEqual(["user-1"]);
  });

  it("does not treat a NULL owner as shared", () => {
    expect(rendered.sql).not.toMatch(/created_by_user_id"?\s+IS\s+NULL/i);
  });
});
