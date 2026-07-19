import { describe, expect, it, vi } from "vitest";

import { assertCriticalTablesExist, CRITICAL_TABLES, isBenignIdempotencyError } from "./migrationGuards";

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
    // the "already exists" detail lives in .cause — the exact shape a
    // push-managed CI/production boot produces.
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
