CREATE TABLE "device_push_tokens" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"token" text NOT NULL,
	"app_version" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_push_tokens_platform_check" CHECK (platform IN ('android', 'ios'))
);
--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_device_push_tokens_token" ON "device_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_device_push_tokens_user_id" ON "device_push_tokens" USING btree ("user_id");