ALTER TABLE "users" ADD COLUMN "training_style_previous_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "training_style_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "training_style_recompute_now" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "maf_age" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "maf_injury_illness_medication" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "maf_consistency" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "maf_trend" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "maf_hr_data_available" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "maf_hr" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "maf_baseline_test_scheduled_at" timestamp with time zone;