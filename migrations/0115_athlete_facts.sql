CREATE TABLE "athlete_facts" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"fact" text NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"category" varchar(24) NOT NULL,
	"source" varchar(24) DEFAULT 'athlete' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"review_on" date DEFAULT (CURRENT_DATE + 90) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_facts_fact_length_check" CHECK (char_length(fact) BETWEEN 1 AND 140),
	CONSTRAINT "athlete_facts_category_check" CHECK (category IN ('constraint', 'equipment', 'schedule', 'preference', 'other')),
	CONSTRAINT "athlete_facts_source_check" CHECK (source IN ('athlete', 'plan_generation', 'onboarding', 'chat'))
);
--> statement-breakpoint
ALTER TABLE "athlete_facts" ADD CONSTRAINT "athlete_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_athlete_facts_user_dedupe" ON "athlete_facts" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_athlete_facts_user_active" ON "athlete_facts" USING btree ("user_id","active");