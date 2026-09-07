ALTER TABLE "workout_logs" ADD COLUMN "device_link_source" text;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "device_link_confidence" real;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "device_activity" jsonb;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "suggested_plan_day_id" varchar(255);--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "suggested_workout_log_id" varchar(255);--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "suggested_link_confidence" real;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_suggested_plan_day_id_plan_days_id_fk" FOREIGN KEY ("suggested_plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_suggested_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("suggested_workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workout_logs_suggested_plan_day_id" ON "workout_logs" USING btree ("suggested_plan_day_id");--> statement-breakpoint
CREATE INDEX "idx_workout_logs_suggested_workout_log_id" ON "workout_logs" USING btree ("suggested_workout_log_id");--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_device_link_source_check" CHECK (device_link_source IS NULL OR device_link_source IN ('auto', 'manual'));