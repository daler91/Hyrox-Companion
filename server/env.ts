// Earliest possible startup signal — emitted before any validation
console.log(JSON.stringify({ level: "info", msg: "Process starting — validating environment...", context: "boot", pid: process.pid, timestamp: new Date().toISOString() }));

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  ENCRYPTION_KEY: z.string().min(32, "Encryption key must be at least 32 characters long"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("5000"),
  SENTRY_DSN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  STRAVA_CLIENT_ID: z.string().optional(),
  STRAVA_CLIENT_SECRET: z.string().optional(),
  STRAVA_STATE_SECRET: z.string().optional(),
  APP_URL: z.string().url().optional(),
  VECTOR_DATABASE_URL: z.string().url().optional(),
  ALLOW_DEV_AUTH_BYPASS: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  RAG_CHUNK_SIZE: z.coerce.number().default(600),
  RAG_CHUNK_OVERLAP: z.coerce.number().default(100),
}).refine((data) => !(data.NODE_ENV === "production" && data.ALLOW_DEV_AUTH_BYPASS === "true"), {
  message: "❌ FATAL: ALLOW_DEV_AUTH_BYPASS cannot be enabled in production environment",
  path: ["ALLOW_DEV_AUTH_BYPASS"],
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Log to both stdout and stderr so Railway captures it regardless of log drain config
  const msg = `❌ Invalid environment variables: ${JSON.stringify(parsed.error.format(), null, 2)}`;
  console.error(msg);
  console.log(JSON.stringify({ level: "fatal", msg, context: "env" }));
  throw new Error(msg);
}

export const env = parsed.data;
