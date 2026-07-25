import { describe, expect, it } from "vitest";

import {
  buildOrphanQuery,
  type CheckResult,
  formatReport,
  hasFailure,
  type Queryable,
  runRestoreDrill,
} from "./restore-drill";

/**
 * A database whose shape each test declares. Only the checks' own SQL reaches
 * it, so routing on distinguishing fragments is enough.
 */
function fakeDb(state: {
  ledgerCount?: number | "absent";
  tables?: string[];
  counts?: Record<string, number>;
  foreignKeys?: { constraint: string; child: string; parent: string; child_cols: string[]; parent_cols: string[] }[];
  orphans?: number;
  ownerlessFoods?: number;
  ownerlessReviews?: number;
  stravaCiphertext?: string | null;
}): Queryable {
  const query = async (sql: string) => {
    if (sql.includes("version()")) return { rows: [{ v: "PostgreSQL 16.13 (test)" }], rowCount: 1 };
    if (sql.includes("__drizzle_migrations")) {
      if (state.ledgerCount === "absent" || state.ledgerCount === undefined) {
        throw new Error('relation "drizzle.__drizzle_migrations" does not exist');
      }
      return { rows: [{ n: state.ledgerCount }], rowCount: 1 };
    }
    if (sql.includes("information_schema.tables")) {
      return { rows: (state.tables ?? []).map((table_name) => ({ table_name })), rowCount: null };
    }
    if (sql.includes("pg_constraint")) {
      return { rows: state.foreignKeys ?? [], rowCount: null };
    }
    if (sql.includes("NOT EXISTS")) return { rows: [{ n: state.orphans ?? 0 }], rowCount: 1 };
    if (sql.includes("source = 'custom'")) return { rows: [{ n: state.ownerlessFoods ?? 0 }], rowCount: 1 };
    if (sql.includes("structured_exercise_backfill_reviews")) {
      return { rows: [{ n: state.ownerlessReviews ?? 0 }], rowCount: 1 };
    }
    if (sql.includes("strava_connections")) {
      const ciphertext = state.stravaCiphertext ?? null;
      return { rows: ciphertext ? [{ ciphertext }] : [], rowCount: ciphertext ? 1 : 0 };
    }
    const countMatch = /FROM "(\w+)"/.exec(sql);
    if (countMatch) return { rows: [{ n: state.counts?.[countMatch[1]] ?? 0 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { query: query as Queryable["query"] };
}

/** Every table the deployed schema expects — read from the real thing. */
async function allSchemaTables(): Promise<string[]> {
  const schema = await import("@shared/schema");
  const { getTableName, is } = await import("drizzle-orm");
  const { PgTable } = await import("drizzle-orm/pg-core");
  const names: string[] = [];
  for (const exported of Object.values(schema)) {
    if (!is(exported, PgTable)) continue;
    names.push(getTableName(exported));
  }
  return names;
}

function find(results: CheckResult[], fragment: string): CheckResult {
  const hit = results.find((r) => r.name.includes(fragment));
  if (!hit) throw new Error(`no check named like "${fragment}" in: ${results.map((r) => r.name).join(", ")}`);
  return hit;
}

describe("buildOrphanQuery", () => {
  it("skips NULL child keys — an unset nullable FK is not an orphan", () => {
    const sql = buildOrphanQuery({
      constraint: "workout_logs_plan_day_id_fk",
      child: "workout_logs",
      parent: "plan_days",
      childCols: ["plan_day_id"],
      parentCols: ["id"],
    });
    expect(sql).toContain(`c."plan_day_id" IS NOT NULL`);
    expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM "plan_days" p WHERE p."id" = c."plan_day_id")`);
  });

  it("ANDs every column of a composite key", () => {
    const sql = buildOrphanQuery({
      constraint: "composite_fk",
      child: "child_t",
      parent: "parent_t",
      childCols: ["a", "b"],
      parentCols: ["x", "y"],
    });
    expect(sql).toContain(`c."a" IS NOT NULL AND c."b" IS NOT NULL`);
    expect(sql).toContain(`p."x" = c."a" AND p."y" = c."b"`);
  });
});

describe("runRestoreDrill", () => {
  it("passes on a healthy restore", async () => {
    const tables = await allSchemaTables();
    const results = await runRestoreDrill(fakeDb({
      ledgerCount: JSON.parse(
        await import("node:fs").then((fs) => fs.readFileSync("migrations/meta/_journal.json", "utf8")),
      ).entries.length,
      tables,
      counts: { users: 42, workout_logs: 900, training_plans: 7 },
      foreignKeys: [{ constraint: "fk", child: "workout_logs", parent: "users", child_cols: ["user_id"], parent_cols: ["id"] }],
    }));

    expect(hasFailure(results)).toBe(false);
    expect(find(results, "Migration ledger").status).toBe("pass");
    expect(find(results, "deployed schema exists").status).toBe("pass");
  });

  it("treats a missing drizzle ledger as expected, not broken", async () => {
    // Production is drizzle-kit push-managed and has no __drizzle_migrations
    // table at all. If that read as a failure the drill would cry wolf on every
    // production restore — the check that carries the weight is schema
    // completeness, which works regardless of how the schema got there.
    const results = await runRestoreDrill(fakeDb({
      ledgerCount: "absent",
      tables: await allSchemaTables(),
      counts: { users: 1 },
      foreignKeys: [],
    }));
    expect(find(results, "Migration ledger").status).toBe("warn");
    expect(find(results, "Migration ledger").detail).toContain("push-managed");
  });

  it("fails when the restored schema is missing tables the code expects", async () => {
    const tables = (await allSchemaTables()).filter((t) => t !== "analytics_results" && t !== "maf_profile");
    const results = await runRestoreDrill(fakeDb({ tables, counts: { users: 1 }, foreignKeys: [] }));

    const check = find(results, "deployed schema exists");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("analytics_results");
    expect(check.detail).toContain("maf_profile");
  });

  it("does not count the vector-DB tables as missing from the primary", async () => {
    // document_chunks / food_embeddings live on VECTOR_DATABASE_URL in split-DB
    // mode, so their absence here is normal and must not fail the drill.
    const tables = (await allSchemaTables()).filter((t) => t !== "document_chunks" && t !== "food_embeddings");
    const results = await runRestoreDrill(fakeDb({ tables, counts: { users: 1 }, foreignKeys: [] }));
    expect(find(results, "deployed schema exists").status).toBe("pass");
  });

  it("fails on an empty users table — schema restored, data never loaded", async () => {
    const results = await runRestoreDrill(fakeDb({
      tables: await allSchemaTables(),
      counts: { users: 0, workout_logs: 0, training_plans: 0 },
      foreignKeys: [],
    }));
    const check = find(results, "Row count: users");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("no data was restored");
  });

  it("fails when a foreign key has orphans (the --disable-triggers restore)", async () => {
    const results = await runRestoreDrill(fakeDb({
      tables: await allSchemaTables(),
      counts: { users: 5 },
      foreignKeys: [{ constraint: "fk", child: "training_plans", parent: "users", child_cols: ["user_id"], parent_cols: ["id"] }],
      orphans: 3,
    }));
    const check = find(results, "orphaned rows");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("training_plans.user_id → users (3)");
  });

  it("fails when NO foreign keys exist at all", async () => {
    // A dump restored without constraints looks clean to a per-FK sweep that
    // has nothing to sweep, so the empty case has to be its own failure.
    const results = await runRestoreDrill(fakeDb({
      tables: await allSchemaTables(),
      counts: { users: 5 },
      foreignKeys: [],
    }));
    expect(find(results, "orphaned rows").status).toBe("fail");
  });

  it("flags the ownerless rows whose cleanup production never applied", async () => {
    const results = await runRestoreDrill(fakeDb({
      tables: await allSchemaTables(),
      counts: { users: 5 },
      foreignKeys: [{ constraint: "fk", child: "training_plans", parent: "users", child_cols: ["user_id"], parent_cols: ["id"] }],
      ownerlessFoods: 12,
      ownerlessReviews: 4,
    }));
    expect(find(results, "0081").status).toBe("fail");
    expect(find(results, "0081").detail).toContain("pending-manual-steps");
    expect(find(results, "0082").status).toBe("fail");
  });

  it("skips the credential check when no key is exported", async () => {
    const previous = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      const results = await runRestoreDrill(fakeDb({ tables: await allSchemaTables(), counts: { users: 1 }, foreignKeys: [] }));
      const check = find(results, "credential decrypts");
      expect(check.status).toBe("skip");
      expect(check.detail).toContain("ENCRYPTION_KEY not set");
    } finally {
      if (previous !== undefined) process.env.ENCRYPTION_KEY = previous;
    }
  });
});

describe("formatReport", () => {
  it("counts skips separately so they never read as verified", () => {
    const report = formatReport(
      [
        { name: "a", status: "pass", detail: "" },
        { name: "b", status: "skip", detail: "" },
        { name: "c", status: "warn", detail: "" },
      ],
      2500,
    );
    expect(report).toContain("PASSED");
    expect(report).toContain("2 check(s) verified, 1 skipped");
    expect(report).toContain("2.5s");
  });

  it("reports failure and the wall clock the RTO is judged against", () => {
    const report = formatReport([{ name: "a", status: "fail", detail: "boom" }], 61_000);
    expect(report).toContain("FAILED — 1 of 1");
    expect(report).toContain("61.0s");
    expect(hasFailure([{ name: "a", status: "fail", detail: "boom" }])).toBe(true);
  });

  it("does not treat warn as failure", () => {
    expect(hasFailure([{ name: "a", status: "warn", detail: "" }, { name: "b", status: "skip", detail: "" }])).toBe(false);
  });
});
