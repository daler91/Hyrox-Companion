CREATE TABLE "idempotency_keys" (
	"user_id" varchar(255) NOT NULL, -- NOSONAR: PostgreSQL varchar (Oracle VARCHAR2 rule N/A)
	"key" varchar(255) NOT NULL, -- NOSONAR: PostgreSQL varchar (Oracle VARCHAR2 rule N/A)
	"method" varchar(10) NOT NULL, -- NOSONAR: PostgreSQL varchar (Oracle VARCHAR2 rule N/A)
	"path" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys" USING btree ("expires_at");