// Importing queue.ts triggers `new PgBoss(...)` at module load, which would
// try to connect to a real DB. Mock pg-boss to a no-op class so the import
// resolves cleanly and we can exercise the pure URL-builder.
import { describe, expect, it, vi } from "vitest";

vi.mock("pg-boss", () => ({
  default: class { on() { /* no-op: pg-boss event emitter stub */ } },
  PgBoss: class { on() { /* no-op: pg-boss event emitter stub */ } },
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./env", () => ({ env: { DATABASE_URL: "postgres://u:p@h:5432/db" } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./emailScheduler", () => ({ processMissedWorkoutReminder: vi.fn(), processWeeklySummary: vi.fn() }));
vi.mock("./services/coachService", () => ({ triggerAutoCoach: vi.fn() }));
vi.mock("./services/planGenerationService", () => ({ executePlanGeneration: vi.fn() }));
vi.mock("./services/ragService", () => ({ embedCoachingMaterial: vi.fn() }));

import { PGBOSS_STATEMENT_TIMEOUT_MS } from "./constants";
import { buildQueueConnectionString } from "./queue";

describe("buildQueueConnectionString (W12)", () => {
  it("appends a PG statement_timeout option matching PGBOSS_STATEMENT_TIMEOUT_MS", () => {
    const url = new URL(buildQueueConnectionString("postgres://u:p@h:5432/db"));
    expect(url.searchParams.get("options")).toBe(`-c statement_timeout=${PGBOSS_STATEMENT_TIMEOUT_MS}`);
  });

  it("preserves an operator-supplied options param by prepending it", () => {
    const url = new URL(
      buildQueueConnectionString("postgres://u:p@h:5432/db?options=-c%20search_path%3Dpublic"),
    );
    const opts = url.searchParams.get("options") ?? "";
    expect(opts).toContain("-c search_path=public");
    expect(opts).toContain(`-c statement_timeout=${PGBOSS_STATEMENT_TIMEOUT_MS}`);
    // Our option must come AFTER the existing one so it wins on conflict
    // (libpq applies options left-to-right; later -c overrides earlier).
    expect(opts.indexOf("statement_timeout")).toBeGreaterThan(opts.indexOf("search_path"));
  });

  it("preserves other URL components (host/port/db/user/password/query params)", () => {
    const result = buildQueueConnectionString("postgres://user:pass@host:5432/mydb?sslmode=require");
    const url = new URL(result);
    expect(url.username).toBe("user");
    expect(url.password).toBe("pass");
    expect(url.hostname).toBe("host");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/mydb");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("uses a timeout below pg-boss expireInMinutes=60 so PG kills before pg-boss reaps", () => {
    expect(PGBOSS_STATEMENT_TIMEOUT_MS).toBeLessThan(60 * 60 * 1000);
    // And above the longest legitimate job query (plan-gen retries ~5min).
    expect(PGBOSS_STATEMENT_TIMEOUT_MS).toBeGreaterThan(10 * 60 * 1000);
  });
});
