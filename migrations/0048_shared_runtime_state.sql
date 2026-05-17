CREATE TABLE "rate_limit_buckets" (
  "key" text PRIMARY KEY NOT NULL,
  "hit_count" integer DEFAULT 0 NOT NULL,
  "reset_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "idx_rate_limit_buckets_reset_at" ON "rate_limit_buckets" USING btree ("reset_at");

CREATE TABLE "server_runtime_cache" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "idx_server_runtime_cache_expires_at" ON "server_runtime_cache" USING btree ("expires_at");
