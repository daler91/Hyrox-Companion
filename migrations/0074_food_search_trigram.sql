-- Fuzzy food search: enable pg_trgm and add trigram GIN indexes so misspelled and
-- mid-string queries match (e.g. "yoghrt" -> "Yogurt"), and so brand is searchable.
-- The existing btree idx_foods_name_lower still serves exact prefix `LIKE 'q%'`.
-- All statements are idempotent (runDrizzleMigrations tolerates "already exists").
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_foods_name_trgm" ON "foods" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_foods_brand_trgm" ON "foods" USING gin (lower("brand") gin_trgm_ops) WHERE "brand" IS NOT NULL;
