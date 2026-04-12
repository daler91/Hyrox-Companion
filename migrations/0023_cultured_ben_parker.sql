CREATE TABLE "garmin_connections" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"garmin_display_name" varchar(255),
	"encrypted_email" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"encrypted_oauth1_token" text,
	"encrypted_oauth2_token" text,
	"token_expires_at" timestamp,
	"last_synced_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "garmin_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "garmin_activity_id" varchar(255);--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD CONSTRAINT "garmin_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workout_logs_garmin_activity_id" ON "workout_logs" USING btree ("garmin_activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workout_logs_user_garmin_unique" ON "workout_logs" USING btree ("user_id","garmin_activity_id") WHERE "workout_logs"."garmin_activity_id" IS NOT NULL;