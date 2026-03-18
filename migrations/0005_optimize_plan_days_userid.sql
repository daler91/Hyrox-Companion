ALTER TABLE "plan_days" ADD COLUMN "user_id" varchar(255);
UPDATE plan_days SET user_id = (SELECT user_id FROM training_plans WHERE training_plans.id = plan_days.plan_id);
ALTER TABLE "plan_days" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "idx_plan_days_user_id" ON "plan_days" USING btree ("user_id");
