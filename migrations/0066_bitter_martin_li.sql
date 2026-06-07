ALTER TABLE "nutrition_targets" ADD COLUMN "periodization_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD COLUMN "reference_utss" real;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD COLUMN "carb_grams_per_utss" real;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bodyweight_kg" real;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "height_cm" real;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activity_level" varchar(24);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weight_goal_direction" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weight_goal_rate_kg_per_week" real;