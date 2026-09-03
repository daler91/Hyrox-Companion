import { beforeEach, describe, expect, it, vi } from "vitest";

// maintenance.ts pulls in the whole boot graph; stub every direct import so the
// module loads without a real DB, then exercise ensureVectorSchema alone.
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn() }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: vi.fn() }));
vi.mock("./advisoryLock", () => ({ withPgAdvisoryLock: vi.fn() }));
vi.mock("./db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("./ai/circuitBreaker", () => ({ loadPersistedBreakerState: vi.fn() }));
vi.mock("./gemini/client", () => ({ EMBEDDING_DIMENSIONS: 3072 }));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));
vi.mock("./migrationGuards", () => ({
  assertCriticalTablesExist: vi.fn(),
  isBenignIdempotencyError: vi.fn(() => false),
}));
vi.mock("./services/keyRotation", () => ({ maybeReencryptOnBoot: vi.fn() }));

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("./vectorDb", () => ({ vectorPool: { connect } }));

import * as Sentry from "@sentry/node";

import { __resetVectorSchemaStatusForTests, ensureVectorSchema, getVectorSchemaStatus } from "./maintenance";

/**
 * A vector DB that remembers what has been created, so the same fake proves
 * both the create path and the idempotent second run.
 */
function fakeVectorDb(options: { hnswThrows?: boolean } = {}) {
  const tables = new Set<string>();
  const indexes = new Set<string>();
  const statements: string[] = [];

  const query = vi.fn(async (sql: string) => {
    statements.push(sql);

    const tableProbe = /table_name = '(\w+)'/.exec(sql);
    if (sql.includes("information_schema.tables") && tableProbe) {
      return { rowCount: tables.has(tableProbe[1]) ? 1 : 0, rows: [] };
    }
    if (sql.includes("information_schema.columns")) {
      // Column already native vector(N) — the text→vector conversion branch is
      // a legacy path and not what this suite is about.
      return { rowCount: 1, rows: [{ data_type: "USER-DEFINED" }] };
    }
    const indexProbe = /indexname = '(\w+)'/.exec(sql);
    if (sql.includes("pg_indexes") && indexProbe) {
      return { rowCount: indexes.has(indexProbe[1]) ? 1 : 0, rows: [] };
    }
    const createTable = /CREATE TABLE "(\w+)"/.exec(sql);
    if (createTable) {
      tables.add(createTable[1]);
      return { rowCount: 0, rows: [] };
    }
    const createIndex = /CREATE INDEX "?(\w+)"?/.exec(sql);
    if (createIndex) {
      if (options.hnswThrows && sql.includes("hnsw")) {
        throw new Error('column cannot have more than 2000 dimensions for hnsw index');
      }
      indexes.add(createIndex[1]);
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });

  return { client: { query, release: vi.fn() }, tables, indexes, statements };
}

describe("ensureVectorSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetVectorSchemaStatusForTests();
  });

  it("starts as pending before boot maintenance runs", () => {
    expect(getVectorSchemaStatus()).toBe("pending");
  });

  it("creates the FULL vector schema on a bare DB and reports ok", async () => {
    const db = fakeVectorDb();
    connect.mockResolvedValue(db.client);

    await ensureVectorSchema();

    // Both tables — the runbook long described only document_chunks, but a
    // vector-DB restore is not complete without food_embeddings either.
    expect([...db.tables].sort()).toEqual(["document_chunks", "food_embeddings"]);
    expect([...db.indexes].sort()).toEqual([
      "idx_document_chunks_embedding_hnsw",
      "idx_document_chunks_material_id",
      "idx_document_chunks_user_id",
      "idx_food_embeddings_hnsw",
    ]);
    expect(getVectorSchemaStatus()).toBe("ok");
    expect(db.client.release).toHaveBeenCalled();
  });

  it("is a no-op on a second run against the schema it just created", async () => {
    const db = fakeVectorDb();
    connect.mockResolvedValue(db.client);

    await ensureVectorSchema();
    const afterFirst = db.statements.length;
    __resetVectorSchemaStatusForTests();
    await ensureVectorSchema();

    const secondRun = db.statements.slice(afterFirst);
    expect(secondRun.some((s) => /CREATE (TABLE|INDEX)/.test(s))).toBe(false);
    expect(getVectorSchemaStatus()).toBe("ok");
  });

  it("reports degraded — not failed — when the HNSW index cannot be built", async () => {
    const db = fakeVectorDb({ hnswThrows: true });
    connect.mockResolvedValue(db.client);

    await ensureVectorSchema();

    // Tables are usable; only approximate-search acceleration is missing, so
    // this must not read the same as a broken vector DB.
    expect([...db.tables].sort()).toEqual(["document_chunks", "food_embeddings"]);
    expect(getVectorSchemaStatus()).toBe("degraded");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("records failed and alerts when setup throws, without blocking boot", async () => {
    const err = new Error("permission denied for schema public");
    connect.mockRejectedValue(err);

    // The whole point: it still resolves. A vector-DB failure must not abort a
    // deploy, because the data there is derived and rebuildable.
    await expect(ensureVectorSchema()).resolves.toBeUndefined();

    expect(getVectorSchemaStatus()).toBe("failed");
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });
});
