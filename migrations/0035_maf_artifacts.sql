CREATE TABLE "user_training_style" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"style" text NOT NULL,
	"effective_date" date NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maf_profile" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"base_hr" integer NOT NULL,
	"adjustment" integer DEFAULT 0 NOT NULL,
	"final_hr" integer NOT NULL,
	"reason" text,
	"phase" text,
	"strict_mode" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maf_test_results" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"protocol_type" text NOT NULL,
	"conditions" jsonb,
	"metrics" jsonb,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maf_workout_analysis" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workout_log_id" varchar(255),
	"compliance_pct" integer,
	"classification" text,
	"next_action" text,
	"analysis_details" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_training_style" ADD CONSTRAINT "user_training_style_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maf_profile" ADD CONSTRAINT "maf_profile_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maf_test_results" ADD CONSTRAINT "maf_test_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maf_workout_analysis" ADD CONSTRAINT "maf_workout_analysis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maf_workout_analysis" ADD CONSTRAINT "maf_workout_analysis_workout_log_id_workout_logs_id_fk" FOREIGN KEY ("workout_log_id") REFERENCES "public"."workout_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_training_style_user_effective" ON "user_training_style" USING btree ("user_id","effective_date");--> statement-breakpoint
CREATE INDEX "idx_maf_profile_user_calculated" ON "maf_profile" USING btree ("user_id","calculated_at");--> statement-breakpoint
CREATE INDEX "idx_maf_test_results_user_created" ON "maf_test_results" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_maf_workout_analysis_user_created" ON "maf_workout_analysis" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_maf_workout_analysis_workout_log_id" ON "maf_workout_analysis" USING btree ("workout_log_id");--> statement-breakpoint
ALTER TABLE "user_training_style" ADD CONSTRAINT "user_training_style_source_check" CHECK (source IN ('onboarding', 'settings', 'migration_default'));--> statement-breakpoint
INSERT INTO "user_training_style" ("user_id", "style", "effective_date", "source")
SELECT "id", COALESCE("training_style_id", 'balanced_default'), CURRENT_DATE, 'migration_default'
FROM "users"
LEFT JOIN "user_training_style" uts ON uts."user_id" = "users"."id"
WHERE uts."user_id" IS NULL;
