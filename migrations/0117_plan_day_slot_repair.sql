-- A plan day moved to another date used to keep the week and weekday it was
-- laid out in: the timeline showed "Week 6" between two week-5 days, and the
-- workout engine and session grades read the old week. Moves now carry the
-- week and weekday of the new date (server/storage/planSlot.ts); this puts the
-- days moved before that back in step.
--
-- A day's slot is its date's week in the plan, counted from week 1's Monday
-- (the Monday of training_plans.start_date's week) and the plan's first week
-- number, and its date's weekday: schedulePlan's layout run backwards, as
-- planSlotFor computes it, a day moved ahead of week 1 counting as the first
-- week. Only scheduled days in a scheduled plan are read, and only those out
-- of step are written; a weekday that differs only in case ("monday") is left
-- as it is. 'Day' without the TM prefix is always the English name, whatever
-- lc_time says.
UPDATE "plan_days" pd
SET week_number = slot.week_number,
    day_name = slot.day_name
FROM (
  SELECT d.id,
         first_week.week_number + greatest(0, (d.scheduled_date - week_one.monday) / 7) AS week_number,
         to_char(d.scheduled_date, 'FMDay') AS day_name
  FROM "plan_days" d
  JOIN "training_plans" tp ON tp.id = d.plan_id
  CROSS JOIN LATERAL (
    SELECT tp.start_date - (extract(isodow FROM tp.start_date)::int - 1) AS monday
  ) week_one
  JOIN (
    SELECT plan_id, min(week_number) AS week_number FROM "plan_days" GROUP BY plan_id
  ) first_week ON first_week.plan_id = d.plan_id
  WHERE d.scheduled_date IS NOT NULL
    AND tp.start_date IS NOT NULL
) slot
WHERE pd.id = slot.id
  AND (pd.week_number <> slot.week_number OR lower(pd.day_name) <> lower(slot.day_name));
