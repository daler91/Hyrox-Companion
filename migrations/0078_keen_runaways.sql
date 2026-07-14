CREATE TABLE "plan_adjustment_proposals" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_id" varchar(255) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary_message" text NOT NULL,
	"user_request" text NOT NULL,
	"payload" jsonb NOT NULL,
	"ai_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "plan_adjustment_proposals_status_check" CHECK (status IN ('pending','applied','dismissed','superseded','invalidated'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "coach_auto_apply_plan_changes" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD CONSTRAINT "plan_adjustment_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD CONSTRAINT "plan_adjustment_proposals_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plan_proposals_user_status" ON "plan_adjustment_proposals" USING btree ("user_id","status");