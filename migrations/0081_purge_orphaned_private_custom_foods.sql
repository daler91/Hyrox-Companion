-- Purge orphaned private custom foods left behind by accounts deleted BEFORE
-- the two-phase erasure in routes/account.ts existed: their owner column was
-- set-null by the FK, and under the old "NULL owner means shared" visibility
-- rule they were exposed to every user. They are already invisible again
-- (visibleTo now requires ownership, a non-custom source, or is_public), so
-- this DELETE erases the at-rest personal data (free-text food names/brands).
--
-- The NOT EXISTS guards are pure safety: rows referencing a user's private
-- custom food always belonged to that user (visibility gated every resolution
-- path at creation time) and cascaded away with their account, so orphans
-- should be unreferenced. Any survivor merely stays hidden.
--
-- Their food_embeddings rows live on the separate vector DB, which SQL
-- migrations cannot reach — the dangling-embedding sweep in the embedding
-- backfill cron (pruneDanglingFoodEmbeddings) cleans those up.
--
-- NOTE for push-managed production: `drizzle-kit push` syncs schema only and
-- boot-time migrate() no-ops against a pushed schema, so run this statement
-- once manually (psql or the post-migration workflow) against production.
-- Tracked with a run-once checkbox in docs/operations/pending-manual-steps.md
-- — tick it there when you run it, so the outstanding step is visible from
-- somewhere other than this file.
DELETE FROM "foods" f
WHERE f."source" = 'custom'
  AND f."created_by_user_id" IS NULL
  AND NOT f."is_public"
  AND NOT EXISTS (SELECT 1 FROM "food_log_entries" e WHERE e."food_id" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "recipe_ingredients" ri WHERE ri."food_id" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "recipes" r WHERE r."food_id" = f."id");
