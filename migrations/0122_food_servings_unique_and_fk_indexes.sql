-- PF11 (CODEBASE_ANALYSIS_2026-10-03): two first opens of a USDA food at once
-- both cached its portions, so the food listed every portion twice. Shared
-- portions (created_by_user_id IS NULL) are now unique on (food_id, label,
-- grams). Before the index can be created, every copy but one is deleted: the
-- copies are identical, and nothing references a serving row (log entries
-- store grams, not a serving id), so the lowest id is kept and nothing needs
-- re-pointing. On a database with no duplicates this matches 0 rows.
--
-- Every statement in this file can run again, so push-managed production can
-- apply it whole, before or after `drizzle-kit push`
-- (docs/operations/pending-manual-steps.md).
DELETE FROM "food_servings" s
WHERE s.created_by_user_id IS NULL
  AND EXISTS (
    SELECT 1 FROM "food_servings" kept
    WHERE kept.created_by_user_id IS NULL
      AND kept.food_id = s.food_id
      AND kept.label = s.label
      AND kept.grams = s.grams
      AND kept.id < s.id
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_food_servings_shared" ON "food_servings" USING btree ("food_id","label","grams") WHERE "food_servings"."created_by_user_id" IS NULL;--> statement-breakpoint
-- PF18: foreign keys whose ON DELETE action scanned the referencing table
-- once per deleted parent row. chat_messages' is partial, since only
-- `proposal` replies carry a proposal_id. food_favorites.food_id had the same
-- gap (its unique index leads with user_id).
CREATE INDEX IF NOT EXISTS "idx_chat_messages_proposal_id" ON "chat_messages" USING btree ("proposal_id") WHERE "chat_messages"."proposal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_food_favorites_food_id" ON "food_favorites" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_adjustment_proposals_plan_id" ON "plan_adjustment_proposals" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_day_moves_plan_day_id" ON "plan_day_moves" USING btree ("plan_day_id");--> statement-breakpoint
-- PF17: the Strava webhook's owner lookup by athlete id. Not unique: one
-- Strava athlete can be connected to more than one account.
CREATE INDEX IF NOT EXISTS "idx_strava_connections_strava_athlete_id" ON "strava_connections" USING btree ("strava_athlete_id");--> statement-breakpoint
-- PF16: the missed-day sweep's per-timezone read of users.
CREATE INDEX IF NOT EXISTS "idx_users_user_timezone" ON "users" USING btree ("user_timezone");
