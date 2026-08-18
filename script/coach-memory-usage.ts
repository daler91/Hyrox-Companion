/**
 * The measurement gating Path C of the coach-memory work
 * (docs/coach-memory-spec.md §7: "Demand is unmeasured").
 *
 * Path C — the full athlete-facts card — is only worth building if athletes
 * actually state durable constraints when given somewhere to put them. These
 * counts answer that from the capture surfaces that already shipped: the
 * plan-wizard/Settings constraints string (Path A), the principles textarea,
 * and timeline annotations (register #2). If all three are near zero, an
 * athlete-facts table would be empty too, and the spec says don't build it.
 *
 * Read-only. Usage:
 *   pnpm tsx script/coach-memory-usage.ts
 */

import { db } from "../server/db";

// db.execute's row constraint wants an index signature, hence the intersection.
type CountRow = Record<string, unknown> & { metric: string; users: string };

async function main(): Promise<void> {
  const result = await db.execute<CountRow>(`
    SELECT 'total users' AS metric, COUNT(*)::text AS users FROM users
    UNION ALL
    SELECT 'with training_constraints set (Path A)', COUNT(*)::text
    FROM users WHERE training_constraints IS NOT NULL AND btrim(training_constraints) <> ''
    UNION ALL
    SELECT 'with >=1 principles material', COUNT(DISTINCT user_id)::text
    FROM coaching_materials WHERE type = 'principles'
    UNION ALL
    SELECT 'with >=1 timeline annotation', COUNT(DISTINCT user_id)::text
    FROM timeline_annotations
    UNION ALL
    SELECT 'with >=1 medical (injury/illness) annotation', COUNT(DISTINCT user_id)::text
    FROM timeline_annotations WHERE type IN ('injury', 'illness')
    UNION ALL
    SELECT 'with >=1 skip reason volunteered', COUNT(DISTINCT tp.user_id)::text
    FROM plan_days pd
    JOIN training_plans tp ON tp.id = pd.plan_id
    WHERE pd.skip_reason IS NOT NULL
    UNION ALL
    SELECT 'with AI coach enabled', COUNT(*)::text
    FROM users WHERE ai_coach_enabled = true
  `);

  // A report script for a human at a terminal — console, not the pino logger.
  console.log("\nCoach memory — capture-surface usage (decision input for Path C)\n");
  for (const row of result.rows) {
    // Static metric labels and aggregate integer counts from the query above —
    // no per-user data ever reaches a row here.
    // bearer:disable javascript_lang_logger_leak
    console.log(`  ${row.metric.padEnd(48)} ${row.users}`);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  // A DB/connection failure from a read-only admin script, printed to the
  // operator's own terminal so they can fix their DATABASE_URL.
  // bearer:disable javascript_lang_logger_leak
  console.error("coach-memory-usage failed:", err);
  process.exit(1);
});
