ALTER TABLE "nutrition_targets" ADD COLUMN "recovery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD COLUMN "recovery_protein_bump_frac" real;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD COLUMN "preload_carb_grams_per_utss" real;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD COLUMN "preload_days_ahead" integer;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD COLUMN "phase_aware" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD COLUMN "max_carb_delta_g" real;