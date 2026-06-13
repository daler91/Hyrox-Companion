ALTER TABLE "foods" DROP CONSTRAINT "foods_source_check";--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "last_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_source_check" CHECK (source IN ('usda', 'off', 'fatsecret', 'custom'));