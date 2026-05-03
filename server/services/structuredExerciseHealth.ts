import { structuredExerciseHealthDailyRollups } from "@shared/schema";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { logger } from "../logger";

type OwnerType = "workout_log" | "plan_day";
type SourceType = "manual" | "voice" | "photo" | "import";
type CounterName = "text_only_rows_detected" | "auto_hydration_attempted" | "auto_hydration_succeeded" | "auto_hydration_failed" | "manual_fix_completed";

export async function incrementStructuredExerciseCounter(ownerType: OwnerType, source: SourceType, counterName: CounterName): Promise<void> {
  await db.execute(sql`
    insert into structured_exercise_health_counters (day, owner_type, source, counter_name, value, updated_at)
    values (current_date, ${ownerType}, ${source}, ${counterName}, 1, now())
    on conflict (day, owner_type, source, counter_name)
    do update set value = structured_exercise_health_counters.value + 1, updated_at = now()
  `);
}

export async function runStructuredExerciseDailyRollup(day: string): Promise<void> {
  const rowResult = await db.execute<{ total_rows: number; structured_rows: number; legacy_only_rows: number; failed_hydration_backlog: number }>(sql`
    with owners as (
      select 'workout_log'::text as owner_type, wl.id as owner_id, wl.date as owner_day,
             case when wl.source in ('strava','garmin') then 'import' when wl.source in ('voice','photo') then wl.source else 'manual' end as source,
             coalesce(wl.main_workout,'') || ' ' || coalesce(wl.accessory,'') as text_blob,
             exists(select 1 from exercise_sets es where es.workout_log_id = wl.id) as has_structured
      from workout_logs wl
      union all
      select 'plan_day'::text, pd.id, pd.scheduled_date,
             'manual'::text,
             coalesce(pd.main_workout,'') || ' ' || coalesce(pd.accessory,''),
             exists(select 1 from exercise_sets es where es.plan_day_id = pd.id)
      from plan_days pd
      where pd.scheduled_date is not null
    )
    select
      count(*)::int as total_rows,
      sum(case when has_structured then 1 else 0 end)::int as structured_rows,
      sum(case when has_structured = false and btrim(text_blob) <> '' then 1 else 0 end)::int as legacy_only_rows,
      (select count(*)::int from structured_exercise_backfill_reviews where status = 'needs_manual_review') as failed_hydration_backlog
    from owners
    where owner_day = ${day}::date
  `);

  const row = rowResult.rows[0];
  const total = Number(row?.total_rows ?? 0);
  const legacyOnly = Number(row?.legacy_only_rows ?? 0);
  const legacyPct = total > 0 ? legacyOnly / total : 0;

  await db.insert(structuredExerciseHealthDailyRollups).values({
    day,
    totalRows: total,
    structuredRows: Number(row?.structured_rows ?? 0),
    legacyOnlyRows: legacyOnly,
    failedHydrationBacklog: Number(row?.failed_hydration_backlog ?? 0),
    legacyOnlyPct: legacyPct,
  }).onConflictDoUpdate({
    target: structuredExerciseHealthDailyRollups.day,
    set: { totalRows: total, structuredRows: Number(row?.structured_rows ?? 0), legacyOnlyRows: legacyOnly, failedHydrationBacklog: Number(row?.failed_hydration_backlog ?? 0), legacyOnlyPct: legacyPct, updatedAt: new Date() },
  });

  const wowResult = await db.execute<{ current_pct: number; prev_pct: number }>(sql`
    with current_week as (
      select avg(legacy_only_pct)::float as pct from structured_exercise_health_daily_rollups
      where day >= (${day}::date - interval '6 days') and day <= ${day}::date
    ), prev_week as (
      select avg(legacy_only_pct)::float as pct from structured_exercise_health_daily_rollups
      where day >= (${day}::date - interval '13 days') and day <= (${day}::date - interval '7 days')
    )
    select coalesce((select pct from current_week),0) as current_pct, coalesce((select pct from prev_week),0) as prev_pct
  `);

  const wow = wowResult.rows[0];
  const currentPct = Number(wow?.current_pct ?? 0);
  const prevPct = Number(wow?.prev_pct ?? 0);
  if (prevPct > 0 && currentPct > prevPct * 1.1) {
    logger.warn({ context: "health-alert", event: "legacy_only_pct_wow_rise", currentPct, prevPct, day }, "Legacy-only percentage rose >10% week-over-week");
  }

  const textOnlyDetected = Math.max(0, legacyOnly);
  await incrementStructuredExerciseCounter("workout_log", "manual", "text_only_rows_detected");
  if (textOnlyDetected > 1) {
    await db.execute(sql`
      update structured_exercise_health_counters
      set value = value + ${textOnlyDetected - 1}, updated_at = now()
      where day = current_date and owner_type = 'workout_log' and source = 'manual' and counter_name = 'text_only_rows_detected'
    `);
  }
}
