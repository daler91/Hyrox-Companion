const fs = require('fs');
let content = fs.readFileSync('server/maintenance.ts', 'utf8');

// The instructions state: "In the backend startup maintenance script (server/maintenance.ts), bypass programmatic Drizzle migrations (migrate()) when process.env.NODE_ENV === 'test'."
const newMigrationsFunc = `async function runDrizzleMigrations() {
  if (process.env.NODE_ENV === "test") {
    logger.info({ context: "db" }, "Skipping programmatic Drizzle migrations in test environment");
    return;
  }

  try {
    const migrationsFolder = path.resolve(import.meta.dirname, "..", "migrations");
    logger.info({ context: "db", migrationsFolder }, "Running Drizzle migrations...");
    await migrate(db, { migrationsFolder });
    logger.info({ context: "db" }, "Drizzle migrations applied successfully");
  } catch (error) {
    // In CI/production, drizzle-kit push is used to manage the schema, so
    // migration failures (e.g. "already exists") are expected and non-fatal.
    const errStr = String((error as { message?: string })?.message ?? error);
    if (errStr.includes("already exists")) {
      logger.info({ context: "db" }, "Drizzle migrations skipped — schema already up to date (drizzle-kit push was used)");
    } else {
      logger.warn({ context: "db", err: error }, "Drizzle migration failed (non-fatal, continuing startup)");
    }
  }
}`;

content = content.replace(/async function runDrizzleMigrations\(\) \{[\s\S]*?catch \(error\) \{[\s\S]*?\}\n\}/, newMigrationsFunc);
fs.writeFileSync('server/maintenance.ts', content);
console.log('maintenance patched');
