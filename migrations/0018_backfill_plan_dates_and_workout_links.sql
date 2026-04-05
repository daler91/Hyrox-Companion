-- Data cleanup + backfills previously run on every boot from server/maintenance.ts.
-- Moved into a one-shot migration (TECHNICAL_DEBT #8).
-- All statements are idempotent: they only touch rows still needing the fix.

-- 1. Null out stale planDayId references (set-null FK is now in place, but older
--    rows from before that FK existed may still point at deleted plan_days).
UPDATE "workout_logs"
SET "plan_day_id" = NULL
WHERE "plan_day_id" IS NOT NULL
  AND "plan_day_id" NOT IN (SELECT "id" FROM "plan_days");
--> statement-breakpoint

-- 2. Backfill start/end dates on training_plans from their scheduled plan_days.
UPDATE "training_plans" tp
SET "start_date" = sub.min_date,
    "end_date" = sub.max_date
FROM (
  SELECT "plan_id",
         MIN("scheduled_date") AS min_date,
         MAX("scheduled_date") AS max_date
  FROM "plan_days"
  WHERE "scheduled_date" IS NOT NULL
  GROUP BY "plan_id"
) sub
WHERE tp."id" = sub.plan_id
  AND tp."start_date" IS NULL;
--> statement-breakpoint

-- 3. Backfill workout_logs.plan_id from plan_days.plan_id for logs linked via plan_day_id.
UPDATE "workout_logs" wl
SET "plan_id" = pd."plan_id"
FROM "plan_days" pd
WHERE wl."plan_day_id" = pd."id"
  AND wl."plan_id" IS NULL;
--> statement-breakpoint

-- 4. Backfill workout_logs.plan_id on standalone logs that fall inside a plan date range.
--    DISTINCT ON picks one plan per workout (latest end_date) to handle overlapping ranges.
UPDATE "workout_logs" wl
SET "plan_id" = best.plan_id
FROM (
  SELECT DISTINCT ON (wl2."id") wl2."id" AS workout_id, tp."id" AS plan_id
  FROM "workout_logs" wl2
  JOIN "training_plans" tp
    ON wl2."user_id" = tp."user_id"
   AND tp."start_date" IS NOT NULL AND tp."end_date" IS NOT NULL
   AND wl2."date" >= tp."start_date" AND wl2."date" <= tp."end_date"
  WHERE wl2."plan_id" IS NULL AND wl2."plan_day_id" IS NULL
  ORDER BY wl2."id", tp."end_date" DESC
) best
WHERE wl."id" = best.workout_id;
