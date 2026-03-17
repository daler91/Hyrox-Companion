CREATE TABLE "chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "custom_exercises" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"category" varchar DEFAULT 'conditioning' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exercise_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_log_id" varchar NOT NULL,
	"exercise_name" varchar NOT NULL,
	"custom_label" text,
	"category" varchar NOT NULL,
	"set_number" integer DEFAULT 1 NOT NULL,
	"reps" integer,
	"weight" real,
	"distance" real,
	"time" real,
	"notes" text,
	"confidence" integer,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "plan_days" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" varchar NOT NULL,
	"week_number" integer NOT NULL,
	"day_name" text NOT NULL,
	"focus" text NOT NULL,
	"main_workout" text NOT NULL,
	"accessory" text,
	"notes" text,
	"scheduled_date" date,
	"status" text DEFAULT 'planned'
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strava_connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"strava_athlete_id" varchar NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"scope" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "strava_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"source_file_name" text,
	"total_weeks" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"weight_unit" varchar DEFAULT 'kg',
	"distance_unit" varchar DEFAULT 'km',
	"weekly_goal" integer DEFAULT 5,
	"email_notifications" integer DEFAULT 1,
	"last_weekly_summary_at" timestamp,
	"last_missed_reminder_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workout_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"date" date NOT NULL,
	"focus" text NOT NULL,
	"main_workout" text NOT NULL,
	"accessory" text,
	"notes" text,
	"duration" integer,
	"rpe" integer,
	"plan_day_id" varchar,
	"source" varchar DEFAULT 'manual',
	"strava_activity_id" varchar,
	"calories" integer,
	"distance_meters" real,
	"elevation_gain" real,
	"avg_heartrate" integer,
	"max_heartrate" integer,
	"avg_speed" real,
	"max_speed" real,
	"avg_cadence" real,
	"avg_watts" integer,
	"suffer_score" integer
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_exercises" ADD CONSTRAINT "custom_exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strava_connections" ADD CONSTRAINT "strava_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_messages_user_id" ON "chat_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_user_time" ON "chat_messages" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_custom_exercises_user_id" ON "custom_exercises" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_custom_exercises_user_name" ON "custom_exercises" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "idx_exercise_sets_workout_log_id" ON "exercise_sets" USING btree ("workout_log_id");--> statement-breakpoint
CREATE INDEX "idx_exercise_sets_exercise_name" ON "exercise_sets" USING btree ("exercise_name");--> statement-breakpoint
CREATE INDEX "idx_exercise_sets_workout_sort" ON "exercise_sets" USING btree ("workout_log_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_exercise_sets_workout_exercise" ON "exercise_sets" USING btree ("workout_log_id","exercise_name");--> statement-breakpoint
CREATE INDEX "idx_plan_days_plan_id" ON "plan_days" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_plan_days_scheduled_date" ON "plan_days" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_plan_days_status" ON "plan_days" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_plan_days_plan_week" ON "plan_days" USING btree ("plan_id","week_number");--> statement-breakpoint
CREATE INDEX "idx_plan_days_plan_status" ON "plan_days" USING btree ("plan_id","status");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_training_plans_user_id" ON "training_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workout_logs_user_id" ON "workout_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workout_logs_date" ON "workout_logs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_workout_logs_user_date" ON "workout_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_workout_logs_plan_day_id" ON "workout_logs" USING btree ("plan_day_id");--> statement-breakpoint
CREATE INDEX "idx_workout_logs_strava_activity_id" ON "workout_logs" USING btree ("strava_activity_id");--> statement-breakpoint
CREATE INDEX "idx_workout_logs_source" ON "workout_logs" USING btree ("source");