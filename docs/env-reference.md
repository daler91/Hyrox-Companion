# Environment Variable Reference

[Back to README](../README.md)

This is the curated companion to [`.env.example`](../.env.example). `.env.example` is the copy-template you clone into `.env`; this page explains *why* each variable exists, which subsystem it unlocks, and what safe defaults look like. The canonical source of truth is the Zod schema in [`server/env.ts`](../server/env.ts) — if a variable is validated there but missing from this page, please update both.

---

## TL;DR — minimum to boot

You only need two variables to start the server locally:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Any reachable Postgres connection string (with `pgvector` installed). |
| `ENCRYPTION_KEY` | 32+ char hex string. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Production also requires `CSRF_SECRET`; it must differ from `ENCRYPTION_KEY`. In development/test, omitting it makes the CSRF middleware generate a random per-process fallback. Everything else is optional and gates a specific feature (Clerk auth, AI providers, Strava sync, Resend email, Web Push, Sentry, etc.).

---

## Table of Contents

- [Core & Security](#core--security)
- [Authentication (Clerk)](#authentication-clerk)
- [AI (Text Providers, Gemini Embeddings, Gemini Vision)](#ai-text-providers-gemini-embeddings-gemini-vision)
- [Integrations](#integrations)
- [Web Push (VAPID)](#web-push-vapid)
- [Error Tracking (Sentry)](#error-tracking-sentry)
- [Runtime & Dev](#runtime--dev)
- [Feature Flags](#feature-flags)
- [Client (Vite) Variables](#client-vite-variables)

---

## Core & Security

| Variable | Req? | Default | Who reads it |
|---|---|---|---|
| `DATABASE_URL` | **Required** | — | Server (`server/db.ts`), pg-boss queue. |
| `VECTOR_DATABASE_URL` | Optional | falls back to `DATABASE_URL` | RAG ingest + retrieval (`server/vectorDb.ts`). |
| `ENCRYPTION_KEY` | **Required** | — | AES-256-GCM for Strava + Garmin tokens at rest (`server/crypto.ts`). |
| `CSRF_SECRET` | Required in `production` | per-process random secret in dev/test | `csrf-csrf` middleware (`server/middleware/csrf.ts`). |
| `TRUST_PROXY` | Optional | `"1"` | Express `app.set("trust proxy", …)` in `server/bootstrap/appConfig.ts`. |
| `ALLOWED_ORIGINS` | Optional | — | CORS allow-list (`server/index.ts`). Localhost is always allowed. |

### Safety invariants (enforced at startup in `server/env.ts`)

- **Key separation**: `CSRF_SECRET` must differ from `ENCRYPTION_KEY` in every environment. If they match, the server refuses to boot.
- **Weak-key rejection**: A small set of obvious placeholder keys (all-zeros, `changeme_...`, the CI test key, etc.) is explicitly rejected in production via the `WEAK_ENCRYPTION_KEYS` list in `server/env.ts:11-17`.
- **Dev bypass lockout**: `ALLOW_DEV_AUTH_BYPASS=true` combined with `NODE_ENV=production` is a hard fatal — the server refuses to boot.
- **Live-key / env mismatch**: a `CLERK_PUBLISHABLE_KEY` starting with `pk_live_` while `NODE_ENV` is not `production` is a hard fatal — it catches a deploy that provisioned live Clerk keys but forgot to set `NODE_ENV=production`.
- **TRUST_PROXY is a three-valued enum**: `"0"` (off — use when Express is exposed directly, rare), `"1"` (trust exactly one hop, correct for Railway and most PaaS), or `"loopback"` (only local reverse proxies). Hardcoding `1` into other deployments where the number of trusted hops changes would let attacker-controlled `X-Forwarded-For` headers drive `req.ip`.

---

### Runtime topology

`APP_INSTANCE_COUNT` defaults to `1` and records the declared app replica count. Production values above `1` are supported after applying migrations: route rate limits use PostgreSQL-backed buckets, the Clerk seen-cache and AI/RAG hot caches use `server_runtime_cache`, and cron bodies use PostgreSQL advisory locks so duplicate schedulers skip work.

---

## Authentication (Clerk)

Clerk is optional. When unset, you can run with `ALLOW_DEV_AUTH_BYPASS=true` for local development.

| Variable | Req? | Default | Who reads it |
|---|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | Optional | — | Server (`@clerk/express`). Must be set if Clerk is enabled at all. |
| `CLERK_SECRET_KEY` | Optional | — | Server. Must be set if Clerk is enabled. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Optional | — | **Client** (`client/src/App.tsx`). Browser-visible — do not put the secret key here. |
| `ALLOW_DEV_AUTH_BYPASS` | Optional | — | Skip auth in dev. **Hard-blocked in production.** |

---

## AI (Text Providers, Gemini Embeddings, Gemini Vision)

Text AI defaults to Gemini for backwards compatibility. Operators can route chat, text parsing, coach suggestions, review notes, coach insights, and plan generation through Anthropic or an OpenAI-compatible provider by changing environment variables. RAG embeddings and photo-to-workout parsing remain pinned to Gemini in this release.

| Variable | Req? | Default | Used by |
|---|---|---|---|
| `AI_FEATURES_ENABLED` | Optional | `true` | Runtime kill switch for **all** AI routes (chat, parsing, plan generation, RAG, coach suggestions). Set to `false` to disable AI provider traffic without redeploying or rotating keys. Enforced in `server/middleware/aibudget.ts`. |
| `AI_TEXT_PROVIDER` | Optional | `gemini` | Text provider: `gemini`, `anthropic`, or `openai-compatible`. |
| `AI_TEXT_MODEL` | Optional | - | Generic text model override for non-Gemini providers. |
| `AI_TEXT_FAST_MODEL` | Optional | provider default | Fast parser model override. Gemini fallback: `GEMINI_MODEL`. |
| `AI_TEXT_REASONING_MODEL` | Optional | provider default | Coaching/planning model override. Gemini fallback: `GEMINI_SUGGESTIONS_MODEL`. |
| `AI_TEXT_REASONING_EFFORT` | Optional | `high` | Reasoning effort hint: `none`, `low`, `medium`, `high`. Applied only where supported. |
| `AI_TEXT_API_KEY` | Optional | - | Generic key fallback for Anthropic or OpenAI-compatible providers. |
| `AI_TEXT_OPENAI_COMPATIBLE_PROFILE` | Optional | `openai` | OpenAI-compatible profile: `openai`, `xai`, `groq`, `together`, `openrouter`, `deepseek`, or `custom`. |
| `AI_TEXT_BASE_URL` | Optional | profile default | Base URL override for OpenAI-compatible providers. Required for `custom`. |
| `OPENAI_API_KEY` / `XAI_API_KEY` / `GROQ_API_KEY` / `TOGETHER_API_KEY` / `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` | Optional | - | Profile-specific OpenAI-compatible API keys. |
| `ANTHROPIC_API_KEY` | Optional | - | Anthropic Messages API key. |
| `GEMINI_API_KEY` | Optional | - | Gemini text provider, RAG embeddings, and photo-to-workout parsing. |
| `GEMINI_MODEL` | Optional | `gemini-2.5-flash-lite` | Legacy Gemini fast text model. |
| `GEMINI_SUGGESTIONS_MODEL` | Optional | `gemini-3.1-pro-preview` | Legacy Gemini reasoning text model. |
| `GEMINI_VISION_MODEL` | Optional | `gemini-2.5-flash` | Photo-to-workout parsing (`POST /api/v1/parse-exercises-from-image`). |
| `RAG_CHUNK_SIZE` | Optional | `600` | Characters per chunk during coaching-material embedding. |
| `RAG_CHUNK_OVERLAP` | Optional | `100` | Character overlap between adjacent chunks. |

---

## Integrations

### Strava

Create an app at [Strava Developers](https://www.strava.com/settings/api).

| Variable | Req? | Default | Notes |
|---|---|---|---|
| `STRAVA_CLIENT_ID` | Optional | — | OAuth client id. Required for the integration. |
| `STRAVA_CLIENT_SECRET` | Optional | — | OAuth client secret. |
| `STRAVA_STATE_SECRET` | Optional | auto-generated at boot | 32+ char secret used to sign OAuth `state`. Setting it keeps signatures stable across restarts. |
| `APP_URL` | Optional | `http://localhost:5000` | Base URL for the OAuth redirect (`${APP_URL}/api/v1/strava/callback`). |

### Resend (email)

| Variable | Req? | Default | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | Optional | — | Without it, the cron still runs but the send step is a no-op (`sendEmail()` logs and returns `false`). |
| `RESEND_FROM_EMAIL` | Optional | `fitai.coach <Timmy@fitai.coach>` | Sender address in `Display Name <address@example.com>` format. |

### Cron

| Variable | Req? | Default | Notes |
|---|---|---|---|
| `CRON_SECRET` | Optional | — | `GET /api/v1/cron/emails` requires `x-cron-secret` to match (timing-safe compare). Used by external cron (Railway / GitHub Actions) to hit the endpoint instead of relying on the in-process node-cron. |
| `INTERNAL_ANALYTICS_SECRET` | Optional | — | `GET /api/v1/analytics/internal/structured-exercise-health` requires `x-internal-analytics-secret` to match. Server-only; do not expose to Vite. |

### Garmin Connect

Garmin has **no environment variables**. The integration uses per-user email+password credentials the user enters in Settings (encrypted with `ENCRYPTION_KEY`). See [integrations.md § Garmin](integrations.md#garmin-connect-integration).

---

## Web Push (VAPID)

When any of these are unset, `/api/v1/push/*` endpoints return `404 PUSH_NOT_CONFIGURED` and the Settings UI hides the notification toggle.

```sh
npx web-push generate-vapid-keys
```

| Variable | Req? | Default | Notes |
|---|---|---|---|
| `VAPID_PUBLIC_KEY` | Optional (required for push) | — | Sent to the client via `GET /api/v1/push/vapid-key`. |
| `VAPID_PRIVATE_KEY` | Optional (required for push) | — | Server-only. Do not expose. |
| `VAPID_EMAIL` | Optional (required for push) | — | Bare contact email address; `server/pushNotifications.ts` prepends `mailto:` when registering VAPID details with push services. |

---

## Error Tracking (Sentry)

Sentry is fully optional. A missing DSN disables init without affecting anything else.

| Variable | Req? | Default | Who reads it |
|---|---|---|---|
| `SENTRY_DSN` | Optional | — | Server (`@sentry/node` via `configureObservability()` in `server/bootstrap/observability.ts`). |
| `VITE_SENTRY_DSN` | Optional | — | Client (`@sentry/react` in `client/src/main.tsx`). |

The Sentry `environment` tag is automatically derived from `NODE_ENV` on the server and from Vite's `MODE` on the client — there is no separate env var for it.

---

## Runtime & Dev

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test`. |
| `PORT` | `5000` | HTTP listener port. |
| `LOG_LEVEL` | `info` | Pino level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`. |
| `APP_INSTANCE_COUNT` | `1` | Declared app replica count. Values above `1` require the shared runtime-state migration and use Postgres-backed rate limits/cache entries. |
| `ALLOW_DEV_AUTH_BYPASS` | — | Dev-only. See [Authentication (Clerk)](#authentication-clerk). |

---

## Feature Flags

Rollout toggles, all parsed as the literal strings `"true"` / `"false"` in `server/env.ts`.

| Variable | Default | Notes |
|---|---|---|
| `EMOM_BUILDER_ENABLED` | `false` | Server-side gate for the EMOM workout builder. Keep aligned with the client `VITE_EMOM_BUILDER_ENABLED` flag for each deployment tier. |
| `STRUCTURED_BLOCKS_ENABLED` | `true` | Enables the structured-blocks workout write path (`server/routes/structuredWriteGuard.ts`). |
| `STRUCTURED_BLOCKS_FALLBACK_FORCE_LEGACY` | `false` | Escape hatch: when `true`, forces the legacy write path even if `STRUCTURED_BLOCKS_ENABLED` is `true`. |

`AI_FEATURES_ENABLED` is also a runtime flag — see [AI](#ai-text-providers-gemini-embeddings-gemini-vision).

---

## Client (Vite) Variables

Variables exposed to browser code must start with `VITE_` — Vite statically inlines any `import.meta.env.VITE_*` at build time. Everything else is server-only.

| Variable | Source | Notes |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `.env` | Browser-safe Clerk key. Mirrors `CLERK_PUBLISHABLE_KEY`. |
| `VITE_SENTRY_DSN` | `.env` | Browser-safe Sentry DSN. Mirrors `SENTRY_DSN`. |
| `VITE_EMOM_BUILDER_ENABLED` | `.env` | Client-side EMOM builder gate (`"true"`/`"false"`, default `false`). Keep aligned with the server `EMOM_BUILDER_ENABLED` flag. |
| `MODE` | Vite built-in | `development` \| `production` — used as Sentry environment tag. |
| `DEV` / `PROD` | Vite built-ins | Boolean guards used by `isDevPreview`, `RagDebugBadge`, etc. |

Do not put any server-only secret (including `CLERK_SECRET_KEY`, `GEMINI_API_KEY`, `AI_TEXT_API_KEY`, provider API keys, `RESEND_API_KEY`, or the VAPID private key) behind a `VITE_` prefix — it would leak into the public JS bundle.
