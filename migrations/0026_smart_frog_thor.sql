ALTER TABLE "exercise_sets" ADD CONSTRAINT "weight_non_negative_check" CHECK (weight IS NULL OR weight >= 0);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "distance_non_negative_check" CHECK (distance IS NULL OR distance >= 0);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "time_non_negative_check" CHECK (time IS NULL OR time >= 0);