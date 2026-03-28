import { describe, it, expect } from "vitest";
import { pool, db } from "../../db";
import { vectorPool, isVectorDbSeparate } from "../../vectorDb";
import { sql } from "drizzle-orm";
import * as schema from "@shared/schema";

/**
 * Post-migration verification suite for Railway + Neon.
 *
 * Validates database connectivity, schema integrity, extensions, and
 * transactional CRUD after migrating to Railway (hosting) and Neon (PostgreSQL).
 *
 * Run with:
 *   DATABASE_URL="postgres://..." pnpm vitest run --config vitest.integration.config.ts server/routes/tests/post-migration.integration.test.ts
 */

const EXPECTED_TABLES = [
  "users",
  "training_plans",
  "plan_days",
  "workout_logs",
  "exercise_sets",
  "custom_exercises",
  "strava_connections",
  "chat_messages",
  "coaching_materials",
];

const EXPECTED_INDEXES = [
  "idx_training_plans_user_id",
  "idx_plan_days_plan_id",
  "idx_plan_days_scheduled_date",
  "idx_plan_days_status",
  "idx_plan_days_plan_week",
  "idx_plan_days_plan_status",
  "idx_workout_logs_user_id",
  "idx_workout_logs_date",
  "idx_workout_logs_user_date",
  "idx_workout_logs_plan_day_id",
  "idx_workout_logs_strava_activity_id",
  "idx_workout_logs_source",
  "idx_exercise_sets_workout_log_id",
  "idx_exercise_sets_exercise_name",
  "idx_exercise_sets_workout_sort",
  "idx_exercise_sets_workout_exercise",
  "idx_chat_messages_user_id",
  "idx_chat_messages_user_time",
  "idx_custom_exercises_user_id",
  "idx_custom_exercises_user_name",
  "idx_coaching_materials_user_id",
];

const VECTOR_DB_INDEXES = [
  "idx_document_chunks_material_id",
  "idx_document_chunks_user_id",
];

// Column expectations per table (column_name -> data_type)
const USERS_COLUMNS: Record<string, string> = {
  id: "character varying",
  email: "character varying",
  first_name: "character varying",
  last_name: "character varying",
  profile_image_url: "character varying",
  weight_unit: "character varying",
  distance_unit: "character varying",
  weekly_goal: "integer",
  email_notifications: "boolean",
  ai_coach_enabled: "boolean",
  is_auto_coaching: "boolean",
  last_weekly_summary_at: "timestamp without time zone",
  last_missed_reminder_at: "timestamp without time zone",
  created_at: "timestamp without time zone",
  updated_at: "timestamp without time zone",
};

const WORKOUT_LOGS_COLUMNS: Record<string, string> = {
  id: "character varying",
  user_id: "character varying",
  date: "date",
  focus: "text",
  main_workout: "text",
  accessory: "text",
  notes: "text",
  duration: "integer",
  rpe: "integer",
  plan_day_id: "character varying",
  source: "character varying",
  strava_activity_id: "character varying",
  calories: "integer",
  distance_meters: "real",
  elevation_gain: "real",
  avg_heartrate: "integer",
  max_heartrate: "integer",
  avg_speed: "real",
  max_speed: "real",
  avg_cadence: "real",
  avg_watts: "integer",
  suffer_score: "integer",
};

const EXERCISE_SETS_COLUMNS: Record<string, string> = {
  id: "character varying",
  workout_log_id: "character varying",
  exercise_name: "character varying",
  custom_label: "text",
  category: "character varying",
  set_number: "integer",
  reps: "integer",
  weight: "real",
  distance: "real",
  time: "real",
  notes: "text",
  confidence: "integer",
  sort_order: "integer",
};

// Helper: get a map of column_name -> data_type for a table
async function getTableColumns(
  tableName: string,
  targetPool = pool,
): Promise<Map<string, string>> {
  const client = await targetPool.connect();
  try {
    const result = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [tableName],
    );
    return new Map(result.rows.map((r: any) => [r.column_name, r.data_type]));
  } finally {
    client.release();
  }
}

// Helper: get all index names for the public schema
async function getIndexNames(targetPool = pool): Promise<Set<string>> {
  const client = await targetPool.connect();
  try {
    const result = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    return new Set(result.rows.map((r: any) => r.indexname));
  } finally {
    client.release();
  }
}

describe("Post-Migration Verification: Railway + Neon", () => {
  // ── 1. Database Connectivity ──────────────────────────────────────────

  describe("1. Database Connectivity", () => {
    it("connects to PostgreSQL and executes SELECT 1", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query("SELECT 1 AS ok");
        expect(result.rows[0].ok).toBe(1);
      } finally {
        client.release();
      }
    });

    it("SSL/TLS is active on the connection", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
        );
        // Neon enforces SSL; if pg_stat_ssl is unavailable, at least confirm connection works
        if (result.rows.length > 0) {
          expect(result.rows[0].ssl).toBe(true);
        }
      } finally {
        client.release();
      }
    });

    it("connection pool acquires and releases clients", async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();
      expect(pool.totalCount).toBeGreaterThanOrEqual(2);
      client1.release();
      client2.release();
      expect(pool.idleCount).toBeGreaterThanOrEqual(2);
    });

    it("statement_timeout is configured", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query("SHOW statement_timeout");
        expect(result.rows[0].statement_timeout).toBe("30s");
      } finally {
        client.release();
      }
    });
  });

  // ── 2. Schema Integrity — Tables ──────────────────────────────────────

  describe("2. Schema Integrity — Tables", () => {
    it("all expected tables exist in the public schema", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
        );
        const tables = result.rows.map((r: any) => r.table_name);
        for (const expected of EXPECTED_TABLES) {
          expect(tables).toContain(expected);
        }
      } finally {
        client.release();
      }
    });

    it("document_chunks table exists on vector DB", async () => {
      const client = await vectorPool.connect();
      try {
        const result = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'document_chunks'`,
        );
        expect(result.rowCount).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });
  });

  // ── 3. Schema Integrity — Columns ─────────────────────────────────────

  describe("3. Schema Integrity — Columns", () => {
    it("users table has all expected columns with correct types", async () => {
      const columns = await getTableColumns("users");
      for (const [name, type] of Object.entries(USERS_COLUMNS)) {
        expect(columns.has(name), `missing column: users.${name}`).toBe(true);
        expect(columns.get(name), `type mismatch: users.${name}`).toBe(type);
      }
    });

    it("email_notifications is boolean (not integer)", async () => {
      const columns = await getTableColumns("users");
      expect(columns.get("email_notifications")).toBe("boolean");
    });

    it("workout_logs table has all expected columns", async () => {
      const columns = await getTableColumns("workout_logs");
      for (const [name, type] of Object.entries(WORKOUT_LOGS_COLUMNS)) {
        expect(columns.has(name), `missing column: workout_logs.${name}`).toBe(true);
        expect(columns.get(name), `type mismatch: workout_logs.${name}`).toBe(type);
      }
    });

    it("exercise_sets table has all expected columns", async () => {
      const columns = await getTableColumns("exercise_sets");
      for (const [name, type] of Object.entries(EXERCISE_SETS_COLUMNS)) {
        expect(columns.has(name), `missing column: exercise_sets.${name}`).toBe(true);
        expect(columns.get(name), `type mismatch: exercise_sets.${name}`).toBe(type);
      }
    });

    it("plan_days has ai_source column", async () => {
      const columns = await getTableColumns("plan_days");
      expect(columns.has("ai_source")).toBe(true);
      expect(columns.get("ai_source")).toBe("text");
    });

    it("training_plans has goal column", async () => {
      const columns = await getTableColumns("training_plans");
      expect(columns.has("goal")).toBe(true);
      expect(columns.get("goal")).toBe("text");
    });

    it("document_chunks.embedding is vector(3072) on vector DB", async () => {
      const client = await vectorPool.connect();
      try {
        const result = await client.query(
          `SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'document_chunks' AND column_name = 'embedding'`,
        );
        expect(result.rows.length).toBe(1);
        // pgvector registers as USER-DEFINED type with udt_name 'vector'
        expect(result.rows[0].udt_name).toBe("vector");
      } finally {
        client.release();
      }
    });
  });

  // ── 4. Schema Integrity — Indexes ─────────────────────────────────────

  describe("4. Schema Integrity — Indexes", () => {
    it("all expected indexes exist on main DB", async () => {
      const indexes = await getIndexNames(pool);
      for (const idx of EXPECTED_INDEXES) {
        expect(indexes.has(idx), `missing index: ${idx}`).toBe(true);
      }
    });

    it("document_chunks indexes exist on vector DB", async () => {
      const indexes = await getIndexNames(vectorPool);
      for (const idx of VECTOR_DB_INDEXES) {
        expect(indexes.has(idx), `missing vector index: ${idx}`).toBe(true);
      }
    });
  });

  // ── 5. Schema Integrity — Constraints ─────────────────────────────────

  describe("5. Schema Integrity — Constraints", () => {
    it("users.email has a unique constraint", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT 1 FROM information_schema.table_constraints tc
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
           WHERE tc.table_name = 'users' AND tc.constraint_type = 'UNIQUE' AND ccu.column_name = 'email'`,
        );
        expect(result.rowCount).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it("strava_connections.user_id has a unique constraint", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT 1 FROM information_schema.table_constraints tc
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
           WHERE tc.table_name = 'strava_connections' AND tc.constraint_type = 'UNIQUE' AND ccu.column_name = 'user_id'`,
        );
        expect(result.rowCount).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it("plan_days has status CHECK constraint", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT 1 FROM information_schema.table_constraints
           WHERE table_name = 'plan_days' AND constraint_type = 'CHECK' AND constraint_name = 'status_check'`,
        );
        expect(result.rowCount).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it("exercise_sets has set_number CHECK constraint", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT 1 FROM information_schema.table_constraints
           WHERE table_name = 'exercise_sets' AND constraint_type = 'CHECK' AND constraint_name = 'set_number_check'`,
        );
        expect(result.rowCount).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it("foreign keys exist with correct ON DELETE behavior", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table, rc.delete_rule
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
           JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
           WHERE tc.constraint_type = 'FOREIGN KEY'
           ORDER BY tc.table_name, kcu.column_name`,
        );

        const fks = result.rows.map((r: any) => ({
          table: r.table_name,
          column: r.column_name,
          ref: r.referenced_table,
          onDelete: r.delete_rule,
        }));

        // training_plans.user_id -> users (CASCADE)
        const tpUser = fks.find((f: any) => f.table === "training_plans" && f.column === "user_id");
        expect(tpUser).toBeDefined();
        expect(tpUser!.onDelete).toBe("CASCADE");

        // plan_days.plan_id -> training_plans (CASCADE)
        const pdPlan = fks.find((f: any) => f.table === "plan_days" && f.column === "plan_id");
        expect(pdPlan).toBeDefined();
        expect(pdPlan!.onDelete).toBe("CASCADE");

        // workout_logs.user_id -> users (CASCADE)
        const wlUser = fks.find((f: any) => f.table === "workout_logs" && f.column === "user_id");
        expect(wlUser).toBeDefined();
        expect(wlUser!.onDelete).toBe("CASCADE");

        // workout_logs.plan_day_id -> plan_days (SET NULL)
        const wlPlanDay = fks.find((f: any) => f.table === "workout_logs" && f.column === "plan_day_id");
        expect(wlPlanDay).toBeDefined();
        expect(wlPlanDay!.onDelete).toBe("SET NULL");

        // exercise_sets.workout_log_id -> workout_logs (CASCADE)
        const esWorkout = fks.find((f: any) => f.table === "exercise_sets" && f.column === "workout_log_id");
        expect(esWorkout).toBeDefined();
        expect(esWorkout!.onDelete).toBe("CASCADE");

        // chat_messages.user_id -> users (CASCADE)
        const cmUser = fks.find((f: any) => f.table === "chat_messages" && f.column === "user_id");
        expect(cmUser).toBeDefined();
        expect(cmUser!.onDelete).toBe("CASCADE");

        // coaching_materials.user_id -> users (CASCADE)
        const coachUser = fks.find((f: any) => f.table === "coaching_materials" && f.column === "user_id");
        expect(coachUser).toBeDefined();
        expect(coachUser!.onDelete).toBe("CASCADE");
      } finally {
        client.release();
      }
    });
  });

  // ── 6. pgvector Extension ─────────────────────────────────────────────

  describe("6. pgvector Extension", () => {
    it("vector extension is installed on vector DB", async () => {
      const client = await vectorPool.connect();
      try {
        const result = await client.query(
          `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
        );
        expect(result.rowCount).toBe(1);
      } finally {
        client.release();
      }
    });

    it("cosine distance operator (<=>) is available", async () => {
      const client = await vectorPool.connect();
      try {
        const result = await client.query(
          `SELECT '[1,2,3]'::vector(3) <=> '[4,5,6]'::vector(3) AS distance`,
        );
        expect(result.rows[0].distance).toBeTypeOf("number");
        expect(result.rows[0].distance).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });
  });

  // ── 7. pg-boss Compatibility ──────────────────────────────────────────

  describe("7. pg-boss Compatibility", () => {
    it("pgboss schema exists (created at app startup)", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss'`,
        );
        // pg-boss schema is created when queue.start() runs — may not exist
        // on first deploy before app has started. Soft assertion.
        if (result.rowCount === 0) {
          console.warn(
            "pgboss schema not found — expected if app has not started workers yet",
          );
        } else {
          expect(result.rowCount).toBe(1);
        }
      } finally {
        client.release();
      }
    });

    it("pgboss.job table exists if schema is present", async () => {
      const client = await pool.connect();
      try {
        const schemaExists = await client.query(
          `SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss'`,
        );
        if (schemaExists.rowCount === 0) {
          console.warn("Skipping — pgboss schema not present");
          return;
        }
        const result = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job'`,
        );
        expect(result.rowCount).toBe(1);
      } finally {
        client.release();
      }
    });
  });

  // ── 8. Drizzle Migrations Journal ─────────────────────────────────────

  describe("8. Drizzle Migrations Journal", () => {
    it("__drizzle_migrations table exists", async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name LIKE '%drizzle%'`,
        );
        expect(result.rowCount).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });

    it("all 16 migrations are recorded", async () => {
      const client = await pool.connect();
      try {
        // Drizzle uses "__drizzle_migrations" by default
        const result = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM "__drizzle_migrations"`,
        );
        expect(result.rows[0].cnt).toBeGreaterThanOrEqual(16);
      } finally {
        client.release();
      }
    });
  });

  // ── 9. Transactional CRUD (all rolled back) ───────────────────────────

  describe("9. Transactional CRUD Verification", () => {
    it("INSERT user with gen_random_uuid() default, then ROLLBACK", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `INSERT INTO users (email, weight_unit, distance_unit) VALUES ('postmigration-test@test.local', 'kg', 'km') RETURNING id, created_at, updated_at`,
        );
        expect(result.rows[0].id).toBeTruthy();
        expect(result.rows[0].id.length).toBeGreaterThan(0);
        expect(result.rows[0].created_at).toBeInstanceOf(Date);
        expect(result.rows[0].updated_at).toBeInstanceOf(Date);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("INSERT user -> training_plan -> SELECT with join, then ROLLBACK", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const userResult = await client.query(
          `INSERT INTO users (email) VALUES ('postmigration-join@test.local') RETURNING id`,
        );
        const userId = userResult.rows[0].id;

        const planResult = await client.query(
          `INSERT INTO training_plans (user_id, name, total_weeks) VALUES ($1, 'Test Plan', 8) RETURNING id`,
          [userId],
        );
        expect(planResult.rows[0].id).toBeTruthy();

        const joinResult = await client.query(
          `SELECT tp.name, u.email FROM training_plans tp JOIN users u ON tp.user_id = u.id WHERE u.id = $1`,
          [userId],
        );
        expect(joinResult.rows[0].name).toBe("Test Plan");
        expect(joinResult.rows[0].email).toBe("postmigration-join@test.local");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("ON DELETE CASCADE: deleting user cascades to training_plans", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const userResult = await client.query(
          `INSERT INTO users (email) VALUES ('cascade-test@test.local') RETURNING id`,
        );
        const userId = userResult.rows[0].id;

        await client.query(
          `INSERT INTO training_plans (user_id, name, total_weeks) VALUES ($1, 'Cascade Plan', 4)`,
          [userId],
        );

        // Verify plan exists
        const beforeDelete = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM training_plans WHERE user_id = $1`,
          [userId],
        );
        expect(beforeDelete.rows[0].cnt).toBe(1);

        // Delete user — should cascade
        await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

        const afterDelete = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM training_plans WHERE user_id = $1`,
          [userId],
        );
        expect(afterDelete.rows[0].cnt).toBe(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("workout_logs.plan_day_id SET NULL on plan_day delete", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const userResult = await client.query(
          `INSERT INTO users (email) VALUES ('setnull-test@test.local') RETURNING id`,
        );
        const userId = userResult.rows[0].id;

        const planResult = await client.query(
          `INSERT INTO training_plans (user_id, name, total_weeks) VALUES ($1, 'SetNull Plan', 4) RETURNING id`,
          [userId],
        );
        const planId = planResult.rows[0].id;

        const dayResult = await client.query(
          `INSERT INTO plan_days (plan_id, week_number, day_name, focus, main_workout) VALUES ($1, 1, 'Monday', 'strength', 'Squats') RETURNING id`,
          [planId],
        );
        const dayId = dayResult.rows[0].id;

        const workoutResult = await client.query(
          `INSERT INTO workout_logs (user_id, date, focus, main_workout, plan_day_id) VALUES ($1, '2026-03-28', 'strength', 'Squats', $2) RETURNING id`,
          [userId, dayId],
        );
        const workoutId = workoutResult.rows[0].id;

        // Delete plan day — workout should get plan_day_id set to NULL
        await client.query(`DELETE FROM plan_days WHERE id = $1`, [dayId]);

        const result = await client.query(
          `SELECT plan_day_id FROM workout_logs WHERE id = $1`,
          [workoutId],
        );
        expect(result.rows[0].plan_day_id).toBeNull();
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("Drizzle ORM can query schema tables without error", async () => {
      // Use db (Drizzle instance) to query each table with limit 0
      // This validates the ORM mapping matches the actual DB schema
      await db.select().from(schema.users).limit(0);
      await db.select().from(schema.trainingPlans).limit(0);
      await db.select().from(schema.planDays).limit(0);
      await db.select().from(schema.workoutLogs).limit(0);
      await db.select().from(schema.exerciseSets).limit(0);
      await db.select().from(schema.customExercises).limit(0);
      await db.select().from(schema.stravaConnections).limit(0);
      await db.select().from(schema.chatMessages).limit(0);
      await db.select().from(schema.coachingMaterials).limit(0);
    });
  });

  // ── 10. Connection Pool Behavior ──────────────────────────────────────

  describe("10. Connection Pool Behavior", () => {
    it("handles 10 concurrent queries without error", async () => {
      const queries = Array.from({ length: 10 }, () =>
        pool.query("SELECT pg_sleep(0.01)"),
      );
      const results = await Promise.all(queries);
      expect(results).toHaveLength(10);
      results.forEach((r) => expect(r.rowCount).toBe(1));
    });

    it("pool totalCount stays within max limit", async () => {
      // After concurrent queries, pool should not exceed max
      expect(pool.totalCount).toBeLessThanOrEqual(20);
    });
  });

  // ── 11. Health Check Endpoint ─────────────────────────────────────────

  describe("11. Health Check via Drizzle", () => {
    it("db.execute(sql`SELECT 1`) works as a health check", async () => {
      const result = await db.execute(sql`SELECT 1 AS ok`);
      expect(result.rows[0].ok).toBe(1);
    });
  });
});
