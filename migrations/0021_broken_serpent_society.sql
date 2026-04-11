ALTER TABLE "users" ADD COLUMN "email_weekly_summary" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_missed_reminder" boolean DEFAULT true;