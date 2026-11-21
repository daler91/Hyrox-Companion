/**
 * How athletes use the coach-memory capture surfaces
 * (docs/coach-memory-spec.md §7: "Demand is unmeasured").
 *
 * This was the gate for Path C, the athlete card: only worth building if
 * athletes state durable constraints when given somewhere to put them. Path C
 * shipped ahead of the measurement at the owner's call, so it now answers the
 * follow-on question: is the card used? It counts athletes on each surface:
 * the card itself (athlete_facts, by where each fact came from), the older
 * plan-wizard/Settings constraints string (Path A), the principles textarea,
 * timeline annotations (register #2) and volunteered skip reasons. It used to
 * have no query on athlete_facts at all (tech debt #69).
 *
 * Read-only, and every row is an aggregate count. Usage:
 *   pnpm tsx script/coach-memory-usage.ts
 */

import { db } from "../server/db";

// db.execute's row constraint wants an index signature, hence the intersection.
type CountRow = Record<string, unknown> & { metric: string; users: string };

export interface UsageCount {
  readonly metric: string;
  readonly users: number;
}

/** The number of athletes on each capture surface, in report order. */
export async function collectCoachMemoryUsage(): Promise<UsageCount[]> {
  const result = await db.execute<CountRow>(`
    SELECT 'total users' AS metric, COUNT(*)::text AS users FROM users
    UNION ALL
    SELECT 'with >=1 active athlete-card fact', COUNT(DISTINCT user_id)::text
    FROM athlete_facts WHERE active
    UNION ALL
    SELECT '  typed in Settings', COUNT(DISTINCT user_id)::text
    FROM athlete_facts WHERE active AND source = 'athlete'
    UNION ALL
    SELECT '  from the plan wizard', COUNT(DISTINCT user_id)::text
    FROM athlete_facts WHERE active AND source = 'plan_generation'
    UNION ALL
    SELECT '  from onboarding', COUNT(DISTINCT user_id)::text
    FROM athlete_facts WHERE active AND source = 'onboarding'
    UNION ALL
    SELECT '  saved from a coach proposal in chat', COUNT(DISTINCT user_id)::text
    FROM athlete_facts WHERE active AND source = 'chat'
    UNION ALL
    SELECT 'with >=1 retired athlete-card fact', COUNT(DISTINCT user_id)::text
    FROM athlete_facts WHERE NOT active
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
  return result.rows.map((row) => ({ metric: row.metric, users: Number(row.users) }));
}

async function main(): Promise<void> {
  const counts = await collectCoachMemoryUsage();
  // A report script for a human at a terminal — console, not the pino logger.
  console.log("\nCoach memory — capture-surface usage\n"); // skipcq: JS-0002
  for (const { metric, users } of counts) {
    // Static metric labels and aggregate integer counts from the query above —
    // no per-user data ever reaches a row here.
    // bearer:disable javascript_lang_logger_leak
    console.log(`  ${metric.padEnd(48)} ${users}`); // skipcq: JS-0002
  }
  process.exit(0);
}

// Importing this module (for tests) must not run the report.
if (process.argv[1]?.endsWith("coach-memory-usage.ts")) {
  try {
    await main();
  } catch (err) {
    // A DB/connection failure from a read-only admin script, printed to the
    // operator's own terminal so they can fix their DATABASE_URL.
    // bearer:disable javascript_lang_logger_leak
    console.error("coach-memory-usage failed:", err); // skipcq: JS-0002
    process.exit(1);
  }
}
