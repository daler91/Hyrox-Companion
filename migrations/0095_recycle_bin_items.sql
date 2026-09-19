CREATE TABLE "recycle_bin_items" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"batch_id" varchar(255),
	"label" text NOT NULL,
	"summary" text,
	"entity_date" date,
	"child_count" integer DEFAULT 0 NOT NULL,
	"strava_activity_id" varchar(255),
	"garmin_activity_id" varchar(255),
	"payload" jsonb NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recycle_bin_items_entity_type_check" CHECK (entity_type IN ('workout_log', 'plan_day', 'training_plan'))
);
--> statement-breakpoint
ALTER TABLE "recycle_bin_items" ADD CONSTRAINT "recycle_bin_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recycle_bin_items_user_deleted" ON "recycle_bin_items" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_recycle_bin_items_expires_at" ON "recycle_bin_items" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_recycle_bin_items_batch_id" ON "recycle_bin_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_recycle_bin_items_user_strava" ON "recycle_bin_items" USING btree ("user_id","strava_activity_id") WHERE "recycle_bin_items"."strava_activity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_recycle_bin_items_user_garmin" ON "recycle_bin_items" USING btree ("user_id","garmin_activity_id") WHERE "recycle_bin_items"."garmin_activity_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recycle_bin_items_entity" ON "recycle_bin_items" USING btree ("entity_type","entity_id");