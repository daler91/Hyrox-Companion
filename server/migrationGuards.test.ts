import { describe, expect, it, vi } from "vitest";

import {
  assertCriticalTablesExist,
  assertSchemaColumnsExist,
  CRITICAL_TABLES,
  declaredSchemaColumns,
  findUnappliedMigrations,
  isBenignIdempotencyError,
  type MigrationJournalEntry,
  readMigrationJournal,
} from "./migrationGuards";

describe("isBenignIdempotencyError", () => {
  it.each([
    'relation "users" already exists',
    'duplicate key value violates unique constraint "users_pkey"',
    'duplicate object: constraint "foods_source_check"',
    'Relation ALREADY EXISTS in schema', // case-insensitive
  ])("classifies %j as benign", (message) => {
    expect(isBenignIdempotencyError(new Error(message))).toBe(true);
  });

  it.each([
    'column reference "id" is ambiguous', // the 0035 fresh-DB failure class
    "syntax error at or near \"SELCT\"",
    'relation "user_training_style" does not exist',
    "connection terminated unexpectedly",
  ])("classifies %j as a real failure", (message) => {
    expect(isBenignIdempotencyError(new Error(message))).toBe(false);
  });

  it("handles non-Error values without throwing", () => {
    expect(isBenignIdempotencyError("table already exists")).toBe(true);
    expect(isBenignIdempotencyError(null)).toBe(false);
    expect(isBenignIdempotencyError(undefined)).toBe(false);
    expect(isBenignIdempotencyError({ message: 42 })).toBe(false);
  });

  it("finds the benign message in the error CAUSE chain (DrizzleQueryError wrapping)", () => {
    // drizzle-orm wraps the pg error: the outer message carries only the SQL,
    // the "already exists" detail lives in .cause — the exact shape a boot
    // against CI's push-built database produces.
    const wrapped = new Error('Failed query: CREATE TABLE "chat_messages" (...);\nparams: ');
    (wrapped as Error & { cause: unknown }).cause = new Error(
      'relation "chat_messages" already exists',
    );
    expect(isBenignIdempotencyError(wrapped)).toBe(true);

    const wrappedReal = new Error("Failed query: INSERT INTO ...;\nparams: ");
    (wrappedReal as Error & { cause: unknown }).cause = new Error(
      'column reference "id" is ambiguous',
    );
    expect(isBenignIdempotencyError(wrappedReal)).toBe(false);
  });

  it("terminates on self-referential cause chains", () => {
    const cyclic = new Error("Failed query: ...");
    (cyclic as Error & { cause: unknown }).cause = cyclic;
    expect(isBenignIdempotencyError(cyclic)).toBe(false);
  });
});

describe("assertCriticalTablesExist", () => {
  it("resolves when no critical table is missing", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(assertCriticalTablesExist(pool)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("to_regclass"), [
      [...CRITICAL_TABLES],
    ]);
  });

  it("throws naming every missing table", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ missing: "users" }, { missing: "foods" }] }),
    };
    await expect(assertCriticalTablesExist(pool)).rejects.toThrow(
      /Critical tables missing after migration: users, foods/,
    );
  });

  it("propagates query errors (fails closed)", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("connection refused")) };
    await expect(assertCriticalTablesExist(pool)).rejects.toThrow("connection refused");
  });
});

describe("assertSchemaColumnsExist (D7)", () => {
  /** information_schema rows for a database that holds exactly `declared`. */
  const rowsFor = (declared: Map<string, string[]>) =>
    [...declared].flatMap(([table, columns]) =>
      columns.map((column) => ({ table_name: table, column_name: column })),
    );

  it("derives what to expect from the Drizzle schema, so a new column needs no list kept by hand", () => {
    const declared = declaredSchemaColumns();
    expect(declared.get("chat_messages")).toContain("attachment"); // migration 0119
    expect(declared.has("athlete_facts")).toBe(true); // 0115
    expect(declared.has("plan_day_moves")).toBe(true); // 0118
    // Lives on the vector DB (ensureVectorSchema), not the primary.
    expect(declared.has("document_chunks")).toBe(false);
  });

  it("resolves when every declared table and column is present, with one information_schema read", async () => {
    const declared = declaredSchemaColumns();
    const pool = { query: vi.fn().mockResolvedValue({ rows: rowsFor(declared) }) };
    await expect(assertSchemaColumnsExist(pool)).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("information_schema.columns"), [
      [...declared.keys()],
    ]);
  });

  it("throws naming a column the release reads that the database lacks, without suggesting drizzle-kit push", async () => {
    // 0119 shipped chat_messages.attachment: every db.select().from(chatMessages)
    // names it, so without it each chat query 500s while readiness says ok.
    // Push would drop objects production holds outside the schema, so the
    // error must not send an operator to it.
    const rows = rowsFor(declaredSchemaColumns()).filter(
      (r) => !(r.table_name === "chat_messages" && r.column_name === "attachment"),
    );
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    const error = await assertSchemaColumnsExist(pool).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message).toMatch(/missing: chat_messages\.attachment\b/);
    expect(message).toContain("Compare drizzle.__drizzle_migrations with migrations/meta/_journal.json");
    expect(message).toContain("do not run drizzle-kit push against production");
    expect(message).not.toContain("Run `drizzle-kit push`");
  });

  it("names the skipped migration when the ledger says one was skipped (the 0019 case)", async () => {
    const rows = rowsFor(declaredSchemaColumns()).filter((r) => r.table_name !== "idempotency_keys");
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    await expect(
      assertSchemaColumnsExist(pool, { skipped: ["0019_add_idempotency_keys"], pending: [] }),
    ).rejects.toThrow(/idempotency_keys \(table\)\. Unapplied migrations — skipped by the migrator .*: 0019_add_idempotency_keys/u);
  });

  it("throws naming a whole table the database lacks", async () => {
    const rows = rowsFor(declaredSchemaColumns()).filter((r) => r.table_name !== "athlete_facts");
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    await expect(assertSchemaColumnsExist(pool)).rejects.toThrow(/athlete_facts \(table\)/);
  });

  it("ignores columns the database has and the code no longer declares (expand/contract)", async () => {
    const rows = [...rowsFor(declaredSchemaColumns()), { table_name: "users", column_name: "retired_column" }];
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };
    await expect(assertSchemaColumnsExist(pool)).resolves.toBeUndefined();
  });

  it("propagates query errors (fails closed)", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("connection refused")) };
    await expect(assertSchemaColumnsExist(pool)).rejects.toThrow("connection refused");
  });
});

describe("findUnappliedMigrations", () => {
  const journal: MigrationJournalEntry[] = [
    { tag: "0017_a", when: 1_000 },
    { tag: "0018_b", when: 3_000 },
    { tag: "0019_c", when: 2_000 }, // older than 0018: the migrator skips it
    { tag: "0020_d", when: 4_000 },
  ];
  const ledgerPool = (present: boolean, createdAt: (string | number)[]) => ({
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ present }] })
      .mockResolvedValueOnce({ rows: createdAt.map((value) => ({ created_at: value })) }),
  });

  it("splits unrecorded entries into skipped (older than the newest row) and pending (newer)", async () => {
    // pg returns bigint as a string; the ledger stores each entry's journal `when`.
    const pool = ledgerPool(true, ["1000", "3000"]);
    await expect(findUnappliedMigrations(pool, journal)).resolves.toEqual({
      skipped: ["0019_c"],
      pending: ["0020_d"],
    });
  });

  it("reports nothing when every entry is recorded", async () => {
    const pool = ledgerPool(true, [1_000, 2_000, 3_000, 4_000]);
    await expect(findUnappliedMigrations(pool, journal)).resolves.toEqual({ skipped: [], pending: [] });
  });

  it("returns null for an empty ledger (a push-built database records nothing)", async () => {
    await expect(findUnappliedMigrations(ledgerPool(true, []), journal)).resolves.toBeNull();
  });

  it("returns null without querying the ledger when it does not exist", async () => {
    const pool = ledgerPool(false, []);
    await expect(findUnappliedMigrations(pool, journal)).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe("readMigrationJournal", () => {
  it("reads every entry of the real journal with its tag and when", () => {
    const entries = readMigrationJournal();
    expect(entries.length).toBeGreaterThan(100);
    expect(entries).toContainEqual({ tag: "0019_add_idempotency_keys", when: 1_775_428_793_648 });
  });
});
