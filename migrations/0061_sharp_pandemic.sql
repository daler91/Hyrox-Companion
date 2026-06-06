CREATE TABLE "user_consents" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"consent_type" varchar(64) NOT NULL,
	"granted" boolean NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_consents_user_type" ON "user_consents" USING btree ("user_id","consent_type");