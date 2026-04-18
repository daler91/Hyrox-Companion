// Earliest possible startup signal — emitted before any validation (pino logger not yet available).
// Uses process.stderr.write (synchronous) instead of console.log to guarantee the message is
// flushed before any crash can kill the process.
process.stderr.write(`[env] Validating environment pid=${process.pid} at=${new Date().toISOString()}\n`);

import { z } from "zod";

// Reject deterministic strings that appear in docs, CI, or tests. If a real
// secret ever matches one of these it would be compromised anyway — they
// leak in public CI logs and example configs (W10).
const WEAK_ENCRYPTION_KEYS = new Set<string>([
  "01234567890123456789012345678901",
  "0123456789abcdef0123456789abcdef",
  "00000000000000000000000000000000",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "changeme_changeme_changeme_change",
]);

const envSchema = z.object({
  DATABASE_URL: z.url(),
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
  APP_URL: z.url().optional(),
  VECTOR_DATABASE_URL: z.url().optional(),
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
  VAPID_EMAIL: z.email().optional(),
}).refine((data) => !(data.NODE_ENV === "production" && data.ALLOW_DEV_AUTH_BYPASS === "true"), {
  message: "❌ FATAL: ALLOW_DEV_AUTH_BYPASS cannot be enabled in production environment",
  path: ["ALLOW_DEV_AUTH_BYPASS"],
}).refine((data) => data.NODE_ENV !== "production" || !!data.CSRF_SECRET, {
  message: "❌ FATAL: CSRF_SECRET is required in production",
  path: ["CSRF_SECRET"],
}).refine((data) => !data.CSRF_SECRET || data.CSRF_SECRET !== data.ENCRYPTION_KEY, {
  // 🛡️ Sentinel: key separation must hold in all environments, not just
  // production (CODEBASE_REVIEW_2026-04-12.md #42). Dev/test defaults that
  // reuse ENCRYPTION_KEY as CSRF_SECRET would otherwise mask the mistake
  // locally and only blow up in prod.
  message: "❌ FATAL: CSRF_SECRET must differ from ENCRYPTION_KEY for proper key separation",
  path: ["CSRF_SECRET"],
}).refine((data) => data.NODE_ENV !== "production" || !WEAK_ENCRYPTION_KEYS.has(data.ENCRYPTION_KEY), {
  // W10 — reject the CI/test placeholder and any other known-weak keys if
  // they ever make it into a production deploy. A real production secret
  // has ~128 bits of entropy; these patterns have effectively none.
  message: "❌ FATAL: ENCRYPTION_KEY is a known weak/test placeholder; generate a real 32-byte random key",
  path: ["ENCRYPTION_KEY"],
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
