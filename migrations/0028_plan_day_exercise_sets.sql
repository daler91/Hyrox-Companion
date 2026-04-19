ALTER TABLE "exercise_sets" ALTER COLUMN "workout_log_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "plan_day_id" varchar(255);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exercise_sets_plan_day_id" ON "exercise_sets" USING btree ("plan_day_id");--> statement-breakpoint
CREATE INDEX "idx_exercise_sets_plan_day_sort" ON "exercise_sets" USING btree ("plan_day_id","sort_order");--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_set_single_owner_check" CHECK ((workout_log_id IS NULL) <> (plan_day_id IS NULL));