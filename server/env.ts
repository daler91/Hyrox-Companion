// Earliest possible startup signal — emitted before any validation (pino logger not yet available)
// eslint-disable-next-line no-console
console.log(JSON.stringify({ level: "info", msg: "Process starting — validating environment...", context: "boot", pid: process.pid, timestamp: new Date().toISOString() }));

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  ENCRYPTION_KEY: z.string().min(32, "Encryption key must be at least 32 characters long"),
  CSRF_SECRET: z.string().min(32, "CSRF secret must be at least 32 characters long").optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("5000"),
  SENTRY_DSN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  STRAVA_CLIENT_ID: z.string().optional(),
  STRAVA_CLIENT_SECRET: z.string().optional(),
  STRAVA_STATE_SECRET: z.string().min(32).optional(),
  APP_URL: z.string().url().optional(),
  VECTOR_DATABASE_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOW_DEV_AUTH_BYPASS: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  // Controls Express "trust proxy" setting. Hardcoding this to 1 is risky in
  // deployments where the number of trusted hops changes, because req.ip then
  // derives from forwarded headers that could be attacker-controlled
  // (CODEBASE_AUDIT.md §2). Accepted values: "0" (off), "1" (one hop),
  // "loopback" (only local proxies).
  TRUST_PROXY: z.enum(["0", "1", "loopback"]).default("1"),
  RAG_CHUNK_SIZE: z.coerce.number().default(600),
  RAG_CHUNK_OVERLAP: z.coerce.number().default(100),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_SUGGESTIONS_MODEL: z.string().default("gemini-3.1-pro-preview"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().email().optional(),
}).refine((data) => !(data.NODE_ENV === "production" && data.ALLOW_DEV_AUTH_BYPASS === "true"), {
  message: "❌ FATAL: ALLOW_DEV_AUTH_BYPASS cannot be enabled in production environment",
  path: ["ALLOW_DEV_AUTH_BYPASS"],
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Log to both stdout and stderr so Railway captures it regardless of log drain config
  const msg = `❌ Invalid environment variables: ${JSON.stringify(parsed.error.format(), null, 2)}`;
  console.error(msg);
  console.log(JSON.stringify({ level: "fatal", msg, context: "env" })); // eslint-disable-line no-console
  throw new Error(msg);
}

export const env = parsed.data;
