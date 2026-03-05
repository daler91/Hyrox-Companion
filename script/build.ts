import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { execSync } from "child_process";
import pg from "pg";

async function cleanOrphanedData() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL, skipping orphan cleanup");
    return;
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM exercise_sets WHERE workout_log_id NOT IN (SELECT id FROM workout_logs)`);
      await client.query(`DELETE FROM chat_messages WHERE user_id NOT IN (SELECT id FROM users)`);
      await client.query(`DELETE FROM custom_exercises WHERE user_id NOT IN (SELECT id FROM users)`);
      await client.query(`DELETE FROM strava_connections WHERE user_id NOT IN (SELECT id FROM users)`);
      await client.query(`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
      await client.query(`DELETE FROM plan_days WHERE plan_id NOT IN (SELECT id FROM training_plans)`);
      await client.query(`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
      await client.query(`DELETE FROM workout_logs WHERE user_id NOT IN (SELECT id FROM users)`);
      await client.query(`DELETE FROM training_plans WHERE user_id NOT IN (SELECT id FROM users)`);
      await client.query("COMMIT");
      console.log("Pre-migration orphan cleanup complete");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.log("Pre-migration orphan cleanup skipped:", error);
  } finally {
    await pool.end();
  }
}

const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function runDbPush() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL, skipping db:push");
    return;
  }
  try {
    console.log("Running database schema push...");
    execSync("npx drizzle-kit push --force", { stdio: "inherit" });
    console.log("Database schema push complete");
  } catch (error) {
    console.log("Database schema push failed:", error);
    throw error;
  }
}

async function buildAll() {
  await cleanOrphanedData();
  await runDbPush();
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
