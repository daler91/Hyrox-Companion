// Earliest possible startup signal — emitted before any validation (pino logger not yet available).
// Uses process.stderr.write (synchronous) instead of console.log to guarantee the message is
// flushed before any crash can kill the process.
process.stderr.write(`[env] Validating environment pid=${process.pid} at=${new Date().toISOString()}\n`);

import { z } from "zod";

import { checkSafeOutboundUrl } from "./ssrfGuard";

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
  // Optional second key enabling zero-downtime ENCRYPTION_KEY rotation (W6).
  // When set, new ciphertext is tagged `v2` and encrypted with this key while
  // the v1 ENCRYPTION_KEY stays available to decrypt and migrate existing data.
  ENCRYPTION_KEY_V2: z.string().min(32, "Encryption key must be at least 32 characters long").optional(),
  // Opt-in: when "true" (and ENCRYPTION_KEY_V2 is set), the server re-encrypts
  // all stored Strava/Garmin credentials to the active key version on boot.
  // Defaults "false" so a normal deploy never rewrites the credential tables.
  ENCRYPTION_REENCRYPT_ON_BOOT: z.enum(["true", "false"]).default("false"),
  CSRF_SECRET: z.string().min(32, "CSRF secret must be at least 32 characters long").optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("5000"),
  SENTRY_DSN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  AI_TEXT_PROVIDER: z.enum(["gemini", "anthropic", "openai-compatible"]).default("gemini"),
  AI_TEXT_MODEL: z.string().optional(),
  AI_TEXT_FAST_MODEL: z.string().optional(),
  AI_TEXT_REASONING_MODEL: z.string().optional(),
  AI_TEXT_REASONING_EFFORT: z.enum(["none", "low", "medium", "high"]).default("high"),
  AI_TEXT_BASE_URL: z
    .url()
    .refine(
      (url) => checkSafeOutboundUrl(url).ok,
      // The refine callback can't pass through the reason from
      // checkSafeOutboundUrl directly (Zod's message function gets just the
      // value), so this message is intentionally generic. The detailed
      // reason is what the underlying guard returns when used elsewhere.
      "AI_TEXT_BASE_URL must not point at a loopback, private, or link-local address (W2 SSRF guard)",
    )
    .optional(),
  AI_TEXT_API_KEY: z.string().optional(),
  AI_TEXT_OPENAI_COMPATIBLE_PROFILE: z.enum(["openai", "xai", "groq", "together", "openrouter", "deepseek", "custom"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  TOGETHER_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  INTERNAL_ANALYTICS_SECRET: z.string().optional(),
  STRAVA_CLIENT_ID: z.string().optional(),
  STRAVA_CLIENT_SECRET: z.string().optional(),
  STRAVA_STATE_SECRET: z.string().min(32).optional(),
  APP_URL: z.url().optional(),
  VECTOR_DATABASE_URL: z.url().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOW_DEV_AUTH_BYPASS: z.string().optional(),
  APP_INSTANCE_COUNT: z.coerce.number().int().positive().default(1),
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
  GEMINI_VISION_MODEL: z.string().default("gemini-2.5-flash"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.email().optional(),
  // Runtime kill-switch for all AI routes (chat, parsing, plan generation,
  // RAG, coach suggestions). Lets operators disable AI provider traffic
  // without redeploying or rotating provider keys. Defaults to "true" so
  // existing deployments behave the same.
  AI_FEATURES_ENABLED: z.enum(["true", "false"]).default("true"),
  STRUCTURED_BLOCKS_ENABLED: z.enum(["true", "false"]).default("true"),
  STRUCTURED_BLOCKS_FALLBACK_FORCE_LEGACY: z.enum(["true", "false"]).default("false"),
  EMOM_BUILDER_ENABLED: z.enum(["true", "false"]).default("false"),
  // Nutrition tracking module (Phases 1–5). On by default now the module is
  // complete; set NUTRITION_ENABLED=false to disable it in an environment. The
  // matching client flag is VITE_NUTRITION_ENABLED (client/src/lib/featureFlags.ts).
  NUTRITION_ENABLED: z.enum(["true", "false"]).default("true"),
  // Free USDA FoodData Central API key for live food search. Optional: when
  // unset the module still works, degrading to locally-cached foods only (NFR-5).
  USDA_API_KEY: z.string().optional(),
  // FatSecret Platform API (OAuth2 client-credentials) — verified branded/barcode
  // food data. Optional: when unset (or when the egress IP isn't whitelisted by
  // FatSecret) food search/barcode degrade to USDA + Open Food Facts as before.
  FATSECRET_CLIENT_ID: z.string().optional(),
  FATSECRET_CLIENT_SECRET: z.string().optional(),
  // Space-delimited OAuth scopes. "basic" (US dataset) is the free-tier default;
  // paid Premier tiers can request e.g. "basic premier barcode localization".
  FATSECRET_SCOPE: z.string().default("basic"),
  // Optional localization, honoured only on a localization-enabled scope/tier.
  FATSECRET_REGION: z.string().optional(),
  FATSECRET_LANGUAGE: z.string().optional(),
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
}).refine((data) => {
  // W6 — the rotation key must be distinct from the active key (an identical
  // one is a no-op that tags ciphertext v2 with no new material) AND from
  // CSRF_SECRET (key separation). A membership test rather than `!==` avoids a
  // direct secret-to-secret comparison operator (Bearer timing-discrepancy).
  if (!data.ENCRYPTION_KEY_V2) return true;
  const otherKeys = [data.ENCRYPTION_KEY, data.CSRF_SECRET].filter((k): k is string => Boolean(k));
  return !otherKeys.includes(data.ENCRYPTION_KEY_V2);
}, {
  message: "❌ FATAL: ENCRYPTION_KEY_V2 must differ from both ENCRYPTION_KEY (rotation target) and CSRF_SECRET (key separation)",
  path: ["ENCRYPTION_KEY_V2"],
}).refine((data) => data.NODE_ENV !== "production" || !data.ENCRYPTION_KEY_V2 || !WEAK_ENCRYPTION_KEYS.has(data.ENCRYPTION_KEY_V2), {
  // W6 — the rotation key must be just as strong as the active key.
  message: "❌ FATAL: ENCRYPTION_KEY_V2 is a known weak/test placeholder; generate a real 32-byte random key",
  path: ["ENCRYPTION_KEY_V2"],
}).refine(
  // Suggestion-10 — catch the most common prod misconfiguration: a deploy
  // that provisioned live Clerk keys but forgot NODE_ENV=production.
  // Without this, all the env refines above silently don't apply,
  // ALLOW_DEV_AUTH_BYPASS would become settable, Sentry trace-sample
  // stays at 100%, and the CSP/secure-cookie gates loosen.
  (data) => !(data.CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") && data.NODE_ENV !== "production"),
  {
    message: "❌ FATAL: pk_live_ Clerk keys detected but NODE_ENV is not 'production' — set NODE_ENV=production on this deploy",
    path: ["NODE_ENV"],
  },
).refine(
  // FatSecret needs BOTH the client id and secret to authenticate; exactly one
  // set is a half-configuration that would silently never work. Zero set is the
  // supported "disabled" default (search/barcode fall back to USDA/OFF).
  (data) => Boolean(data.FATSECRET_CLIENT_ID) === Boolean(data.FATSECRET_CLIENT_SECRET),
  {
    message: "❌ FATAL: FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET must be set together (or both omitted)",
    path: ["FATSECRET_CLIENT_SECRET"],
  },
);

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Log to both stdout and stderr so Railway captures it regardless of log drain config
  const msg = `❌ Invalid environment variables: ${JSON.stringify(parsed.error.format(), null, 2)}`;
  console.error(msg);
  console.log(JSON.stringify({ level: "fatal", msg, context: "env" })); // eslint-disable-line no-console
  throw new Error(msg);
}

export const env = parsed.data;

export function parseEnv(input: NodeJS.ProcessEnv) {
  return envSchema.parse(input);
}
