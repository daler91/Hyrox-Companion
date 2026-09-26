ALTER TABLE "plan_days" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "plan_days" ADD COLUMN "recovery" text;--> statement-breakpoint
ALTER TABLE "plan_days" ADD COLUMN "missed_on" date;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_priority_check" CHECK (priority IS NULL OR priority IN ('key', 'supporting', 'optional'));--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_recovery_check" CHECK (recovery IS NULL OR recovery IN ('folded', 'shortened', 'let_go'));