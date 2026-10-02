/**
 * Whether the coach chat helps (AI coach chat review, I23): what became of the
 * plan proposals it drafted, and what athletes thought of its replies.
 * ai_usage_logs says what the chat cost; this says whether it worked. The
 * per-turn timings and decisions are in the `[chat] turn` log line instead.
 *
 * Read-only, aggregate counts only. Usage:
 *   pnpm tsx script/chat-quality-report.ts            # the last 30 days
 *   pnpm tsx script/chat-quality-report.ts --days 7
 */

import { sql } from "drizzle-orm";

import { db } from "../server/db";
import { type ChatQualityStats, formatChatQualityReport, parseDays } from "./chatQualityFormat";

// db.execute's row constraint wants an index signature, hence the intersections.
type StatusRow = Record<string, unknown> & { status: string; n: number; partly: number };
type FeedbackRow = Record<string, unknown> & { replies: number; up: number; down: number };

async function readStats(days: number): Promise<ChatQualityStats> {
  const since = sql`now() - make_interval(days => ${days})`;
  const proposals = await db.execute<StatusRow>(sql`
    SELECT status,
           COUNT(*)::int AS n,
           COUNT(*) FILTER (
             WHERE apply_undo IS NOT NULL
               AND jsonb_array_length(apply_undo->'days') < jsonb_array_length(payload->'changes')
           )::int AS partly
    FROM plan_adjustment_proposals
    WHERE created_at >= ${since}
    GROUP BY status
  `);
  const feedback = await db.execute<FeedbackRow>(sql`
    SELECT COUNT(*)::int AS replies,
           COUNT(*) FILTER (WHERE feedback = 'up')::int AS up,
           COUNT(*) FILTER (WHERE feedback = 'down')::int AS down
    FROM chat_messages
    WHERE role = 'assistant' AND kind IN ('text', 'proposal') AND timestamp >= ${since}
  `);
  const count = (status: string) => proposals.rows.find((row) => row.status === status)?.n ?? 0;
  const replies = feedback.rows[0];
  return {
    days,
    proposals: {
      pending: count("pending"),
      applied: count("applied"),
      partlyApplied: proposals.rows.reduce((sum, row) => sum + row.partly, 0),
      dismissed: count("dismissed"),
      superseded: count("superseded"),
      invalidated: count("invalidated"),
      reverted: count("reverted"),
    },
    feedback: { replies: replies?.replies ?? 0, up: replies?.up ?? 0, down: replies?.down ?? 0 },
  };
}

async function main(): Promise<void> {
  const stats = await readStats(parseDays(process.argv.slice(2)));
  // A report for a human at a terminal: aggregate counts and fixed labels, no
  // per-athlete data.
  // bearer:disable javascript_lang_logger_leak
  process.stdout.write(`${formatChatQualityReport(stats)}\n`);
  process.exit(0);
}

try {
  await main();
} catch (err) {
  // A DB/connection failure from a read-only admin script, printed to the
  // operator's own terminal so they can fix their DATABASE_URL.
  // bearer:disable javascript_lang_logger_leak
  console.error("chat-quality-report failed:", err);
  process.exit(1);
}
