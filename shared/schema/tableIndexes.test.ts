import { is } from "drizzle-orm";
import { getTableConfig, type Index, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as allTables from "./tables";
import { chatMessages, foodServings, stravaConnections, users } from "./tables";

/** The column names an index covers, in order; an expression reads as "". */
function indexColumns(index: Index): string[] {
  return index.config.columns.map((column) =>
    "name" in column && typeof column.name === "string" ? column.name : "",
  );
}

/** Columns an index, unique constraint or primary key leads with, so a lookup on that column alone can use it. */
function leadingColumns(table: PgTable): Set<string> {
  const config = getTableConfig(table);
  const leading = new Set<string>();
  for (const index of config.indexes) leading.add(indexColumns(index).at(0) ?? "");
  for (const key of config.primaryKeys) leading.add(key.columns.at(0)?.name ?? "");
  for (const unique of config.uniqueConstraints) leading.add(unique.columns.at(0)?.name ?? "");
  for (const column of config.columns) {
    if (column.primary || column.isUnique) leading.add(column.name);
  }
  return leading;
}

function findIndex(table: PgTable, name: string): Index {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === name);
  if (!index) throw new Error(`${getTableConfig(table).name} declares no index ${name}`);
  return index;
}

/** An index's partial-index predicate as the DDL renders it, or null when it covers every row. */
function wherePredicate(index: Index): string | null {
  const { where } = index.config;
  return where ? new PgDialect().sqlToQuery(where).sql : null;
}

describe("foreign keys are indexed (PF18, CODEBASE_ANALYSIS_2026-10-03)", () => {
  it("leads an index with every foreign-key column", () => {
    // Deleting a parent row finds its referencing rows by the FK column, both
    // to run the ON DELETE action and to check a RESTRICT. With no index
    // leading with that column Postgres scans the whole referencing table once
    // per deleted parent: deleting a plan scanned chat_messages once per
    // proposal. Index the column in shared/schema/tables.ts (a partial index
    // on `col IS NOT NULL` serves a mostly-NULL column).
    const unindexed: string[] = [];
    for (const table of Object.values(allTables)) {
      if (!is(table, PgTable)) continue;
      const config = getTableConfig(table);
      const leading = leadingColumns(table);
      for (const foreignKey of config.foreignKeys) {
        const column = foreignKey.reference().columns.at(0)?.name ?? "";
        if (!leading.has(column)) unindexed.push(`${config.name}.${column}`);
      }
    }
    expect(unindexed).toEqual([]);
  });

  it("indexes chat_messages.proposal_id only where a reply carries one", () => {
    const index = findIndex(chatMessages, "idx_chat_messages_proposal_id");
    expect(indexColumns(index)).toEqual(["proposal_id"]);
    expect(wherePredicate(index)).toBe('"chat_messages"."proposal_id" IS NOT NULL');
  });
});

describe("lookup indexes (CODEBASE_ANALYSIS_2026-10-03)", () => {
  it("indexes the Strava webhook's owner lookup, not uniquely (PF17)", () => {
    // One Strava athlete can be connected to more than one account, so a
    // unique index would refuse the second connection.
    const index = findIndex(stravaConnections, "idx_strava_connections_strava_athlete_id");
    expect(indexColumns(index)).toEqual(["strava_athlete_id"]);
    expect(index.config.unique).toBe(false);
  });

  it("indexes users by timezone for the missed-day sweep (PF16)", () => {
    const index = findIndex(users, "idx_users_user_timezone");
    expect(indexColumns(index)).toEqual(["user_timezone"]);
  });

  it("keeps one copy of each shared serving, leaving personal ones to their owners (PF11)", () => {
    const index = findIndex(foodServings, "uq_food_servings_shared");
    expect(indexColumns(index)).toEqual(["food_id", "label", "grams"]);
    expect(index.config.unique).toBe(true);
    expect(wherePredicate(index)).toBe('"food_servings"."created_by_user_id" IS NULL');
  });
});
