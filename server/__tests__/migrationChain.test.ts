import { describe, expect, it } from "vitest";

import journalText from "../../migrations/meta/_journal.json?raw";

/**
 * Guards on the migration chain itself, which no other unit test reads: a
 * migration can be committed in a shape that applies cleanly to CI's fresh
 * database and still goes wrong on a real one.
 */

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

const journal = JSON.parse(journalText) as { entries: JournalEntry[] };

/**
 * Entries whose `when` is not above every earlier entry's, by tag. Drizzle's
 * migrator applies only the migrations whose `when` is above the newest one in
 * the ledger (drizzle-orm pg-core dialect.migrate), so such an entry is skipped
 * without an error on a database that has already applied a later-dated
 * predecessor. These three are history and stay as they are: they only bite a
 * database whose ledger stopped between 0008 and 0018 and then moved on (a
 * fresh one applies the whole chain in one run), and rewriting a `when` would
 * change the value every applied database recorded in its ledger.
 */
const KNOWN_INVERSIONS: ReadonlyMap<string, number> = new Map([
  ["0009_lovely_ser_duncan", 1774119488847],
  ["0011_shocking_triathlon", 1774230141604],
  ["0019_add_idempotency_keys", 1775428793648],
]);

describe("migration journal order (D26, CODEBASE_ANALYSIS_2026-10-03)", () => {
  it("numbers its entries 0, 1, 2… in file order", () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual([...journal.entries.keys()]);
  });

  it("dates every new entry after every earlier one", () => {
    let newest = Number.NEGATIVE_INFINITY;
    const inversions = new Map<string, number>();
    for (const entry of journal.entries) {
      if (entry.when <= newest) inversions.set(entry.tag, entry.when);
      newest = Math.max(newest, entry.when);
    }
    // A failure naming a new tag: give that migration a `when` above the
    // newest one (Date.now() when it is generated after the others) rather
    // than adding it here, or the migrator skips it on every database that has
    // applied the migration dated after it.
    expect(inversions).toEqual(KNOWN_INVERSIONS);
  });
});

/** Every migration file's text in apply order, comments stripped and whitespace collapsed. */
function migrationSql(): { file: string; sql: string }[] {
  const files = import.meta.glob<string>("../../migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, text]) => ({
      file,
      sql: text.replaceAll(/--[^\n]*/g, " ").replaceAll(/\s+/g, " "),
    }));
}

/**
 * The named constraints the chain leaves behind, in apply order: each ADD (or
 * inline CONSTRAINT in a CREATE TABLE) adds one, DROP removes it, RENAME moves it.
 */
function constraintsAfterChain(): Map<string, string> {
  const live = new Map<string, string>();
  const pattern =
    /(DROP CONSTRAINT (?:IF EXISTS )?|RENAME CONSTRAINT |(?:ADD|,) ?CONSTRAINT )"([^"]+)"/gi;
  // A RENAME's new name follows the match; read it with a separate anchored
  // pattern rather than an optional group, which the security lint reads as
  // a nested quantifier.
  const renameTarget = /^ TO "([^"]+)"/i;
  for (const { file, sql } of migrationSql()) {
    for (const match of sql.matchAll(pattern)) {
      const [whole, action, name] = match;
      const verb = action.trim().toUpperCase();
      if (verb.startsWith("DROP") || verb.startsWith("RENAME")) live.delete(name);
      if (verb.startsWith("RENAME")) {
        const renamedTo = renameTarget.exec(sql.slice((match.index ?? 0) + whole.length))?.at(1);
        if (renamedTo) live.set(renamedTo, file);
      }
      if (!verb.startsWith("DROP") && !verb.startsWith("RENAME")) live.set(name, file);
    }
  }
  return live;
}

interface SnapshotTable {
  readonly foreignKeys?: Record<string, unknown>;
  readonly compositePrimaryKeys?: Record<string, unknown>;
  readonly uniqueConstraints?: Record<string, unknown>;
  readonly checkConstraints?: Record<string, unknown>;
}

/** The constraint names in the newest snapshot, which `db:generate` keeps equal to shared/schema. */
async function schemaConstraints(): Promise<Set<string>> {
  const snapshots = import.meta.glob<{ tables: Record<string, SnapshotTable> }>(
    "../../migrations/meta/*_snapshot.json",
    { import: "default" },
  );
  const newest = Object.entries(snapshots)
    .sort(([left], [right]) => left.localeCompare(right))
    .at(-1);
  if (!newest) throw new Error("no migration snapshot found");
  const [, load] = newest;
  const snapshot = await load();
  const names = new Set<string>();
  for (const table of Object.values(snapshot.tables)) {
    const { foreignKeys, compositePrimaryKeys, uniqueConstraints, checkConstraints } = table;
    for (const group of [foreignKeys, compositePrimaryKeys, uniqueConstraints, checkConstraints]) {
      for (const name of Object.keys(group ?? {})) names.add(name);
    }
  }
  return names;
}

/**
 * document_chunks lives on the vector database, created at boot by
 * ensureVectorTables (server/maintenance.ts) without foreign keys, so no
 * migration creates these two; push-built databases that share one Postgres
 * get them from the schema.
 */
const SCHEMA_ONLY = new Set([
  "document_chunks_material_id_coaching_materials_id_fk",
  "document_chunks_user_id_users_id_fk",
]);

describe("migration chain and schema constraints (D25, CODEBASE_ANALYSIS_2026-10-03)", () => {
  it("leaves no constraint that shared/schema does not declare", async () => {
    // Production's schema comes from `drizzle-kit push`, development's and
    // CI's fresh database from the migrations. A constraint only a migration
    // adds is enforced on the second and not the first, as 0041's two
    // exercise_sets FKs and 0036's two MAF CHECKs were until 0121. Declare it
    // in shared/schema, or drop it in a later migration.
    const declared = await schemaConstraints();
    const migrationOnly = [...constraintsAfterChain()].filter(([name]) => !declared.has(name));
    expect(migrationOnly).toEqual([]);
  });

  it("creates every constraint shared/schema declares", async () => {
    const created = constraintsAfterChain();
    const schemaOnly = [...(await schemaConstraints())].filter((name) => !created.has(name));
    expect(new Set(schemaOnly)).toEqual(SCHEMA_ONLY);
  });
});
