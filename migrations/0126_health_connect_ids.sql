ALTER TABLE "recycle_bin_items" ADD COLUMN "health_connect_id" varchar(255);--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "health_connect_id" varchar(255);--> statement-breakpoint
CREATE INDEX "idx_recycle_bin_items_user_health_connect" ON "recycle_bin_items" USING btree ("user_id","health_connect_id") WHERE "recycle_bin_items"."health_connect_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workout_logs_user_health_connect_unique" ON "workout_logs" USING btree ("user_id","health_connect_id") WHERE "workout_logs"."health_connect_id" IS NOT NULL;