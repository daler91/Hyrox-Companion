ALTER TABLE "training_plans" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "plan_id" varchar(255);--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workout_logs_plan_id" ON "workout_logs" USING btree ("plan_id");