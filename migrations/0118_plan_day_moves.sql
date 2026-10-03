CREATE TABLE "plan_day_moves" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_day_id" varchar(255) NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"kind" varchar(20) NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_day_moves_kind_check" CHECK (kind IN ('moved', 'folded', 'shortened', 'recovery_undone')),
	CONSTRAINT "plan_day_moves_dates_check" CHECK (from_date <> to_date)
);
--> statement-breakpoint
ALTER TABLE "plan_day_moves" ADD CONSTRAINT "plan_day_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day_moves" ADD CONSTRAINT "plan_day_moves_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plan_day_moves_user_moved" ON "plan_day_moves" USING btree ("user_id","moved_at");