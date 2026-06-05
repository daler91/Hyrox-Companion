CREATE TABLE "analytics_results" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"feature" text NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_workout_date_at_generation" date,
	"recomputed_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_results_feature_check" CHECK (feature IN ('coach_insights', 'race_prediction'))
);
--> statement-breakpoint
ALTER TABLE "analytics_results" ADD CONSTRAINT "analytics_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analytics_results_user_feature" ON "analytics_results" USING btree ("user_id","feature");--> statement-breakpoint
CREATE INDEX "idx_analytics_results_feature" ON "analytics_results" USING btree ("feature");