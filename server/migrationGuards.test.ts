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
