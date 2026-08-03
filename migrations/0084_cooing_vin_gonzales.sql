ALTER TABLE "users" ADD COLUMN "push_refuel_reminder" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_logging_reminder" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_refuel_reminder_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_logging_reminder_at" timestamp;