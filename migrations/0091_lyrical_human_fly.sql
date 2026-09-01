-- Concurrency guards for three check-then-act races (CODEBASE_ANALYSIS_2026-08-31
-- priority item 4). Each CREATE UNIQUE INDEX below is preceded by a remediation
-- statement so the index cannot fail to apply on a database that already carries
-- duplicates produced by the race it closes (same convention as 0036/0081).
-- On a database with no duplicates every remediation statement affects 0 rows.

-- meal_targets: upsertMealTarget's delete-then-insert kept one row per
-- (user, meal, effective_from) only for serialized writers. Survivor choice is
-- arbitrary-but-deterministic (max id): duplicate rows came from near-simultaneous
-- saves of the same form, so any one of them is the version the athlete saved.
DELETE FROM "meal_targets" mt USING "meal_targets" newer
WHERE mt.user_id = newer.user_id
  AND mt.meal_type = newer.meal_type
  AND mt.effective_from = newer.effective_from
  AND mt.id < newer.id;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_meal_targets_user_meal_effective" ON "meal_targets" USING btree ("user_id","meal_type","effective_from");--> statement-breakpoint
-- nutrition_targets: same shape, per (user, effective_from).
DELETE FROM "nutrition_targets" nt USING "nutrition_targets" newer
WHERE nt.user_id = newer.user_id
  AND nt.effective_from = newer.effective_from
  AND nt.id < newer.id;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_nutrition_targets_user_effective" ON "nutrition_targets" USING btree ("user_id","effective_from");--> statement-breakpoint
-- training_plans: hasInFlightPlanGeneration's SELECT-then-INSERT let two
-- concurrent /plans/generate requests each create a pending stub. Duplicate
-- in-flight rows are FAILED, not deleted — the same terminal state the startup
-- stuck-generation sweep uses — keeping the newest by generation_started_at
-- (ties broken by id) as the one live generation.
UPDATE "training_plans" tp
SET generation_status = 'failed',
    generation_error = 'Superseded by a concurrent generation request (deduplicated by migration 0091)'
WHERE tp.generation_status IN ('pending', 'generating')
  AND EXISTS (
    SELECT 1 FROM "training_plans" newer
    WHERE newer.user_id = tp.user_id
      AND newer.generation_status IN ('pending', 'generating')
      AND (newer.generation_started_at > tp.generation_started_at
        OR (newer.generation_started_at = tp.generation_started_at AND newer.id > tp.id))
  );--> statement-breakpoint
CREATE UNIQUE INDEX "uq_training_plans_user_in_flight" ON "training_plans" USING btree ("user_id") WHERE generation_status IN ('pending', 'generating');
