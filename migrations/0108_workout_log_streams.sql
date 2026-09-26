CREATE TABLE "workout_log_streams" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_log_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"strava_activity_id" varchar(255) NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"bucket_seconds" integer,
	"samples" jsonb,
	"last_error" text,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_log_streams_status_check" CHECK (status IN ('ok', 'no_heartrate', 'unavailable', 'failed', 'skipped')),
	CONSTRAINT "workout_log_streams_attempts_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "workout_log_streams" ADD CONSTRAINT "workout_log_streams_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_log_streams" ADD CONSTRAINT "workout_log_streams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workout_log_streams_workout_log" ON "workout_log_streams" USING btree ("workout_log_id");--> statement-breakpoint
CREATE INDEX "idx_workout_log_streams_user" ON "workout_log_streams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workout_log_streams_last_attempt" ON "workout_log_streams" USING btree ("last_attempt_at");