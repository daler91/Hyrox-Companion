# Environment Variable Reference

[Back to README](../README.md)

This is the curated companion to [`.env.example`](../.env.example). `.env.example` is the copy-template you clone into `.env`; this page explains *why* each variable exists, which subsystem it unlocks, and what safe defaults look like. The canonical source of truth is the Zod schema in [`server/env.ts`](../server/env.ts) — if a variable is validated there but missing from this page, please update both.

---

## TL;DR — minimum to boot

You only need three variables to start the server locally:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Any reachable Postgres connection string (with `pgvector` installed). |
| `ENCRYPTION_KEY` | 32+ char hex string. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CSRF_SECRET` | Production only. Must differ from `ENCRYPTION_KEY`. Same generator as above. |

Everything else is optional and gates a specific feature (Clerk auth, Gemini parsing, Strava sync, Resend email, Web Push, Sentry, etc.).

---

## Table of Contents

- [Core & Security](#core--security)
- [Authentication (Clerk)](#authentication-clerk)
- [AI (Google Gemini)](#ai-google-gemini)
- [Integrations](#integrations)
- [Web Push (VAPID)](#web-push-vapid)
- [Error Tracking (Sentry)](#error-tracking-sentry)
- [Runtime & Dev](#runtime--dev)
- [Client (Vite) Variables](#client-vite-variables)

---

## Core & Security

| Variable | Req? | Default | Who reads it |
|---|---|---|---|
| `DATABASE_URL` | **Required** | — | Server (`server/db.ts`), pg-boss queue. |
| `VECTOR_DATABASE_URL` | Optional | falls back to `DATABASE_URL` | RAG ingest + retrieval (`server/vectorDb.ts`). |
| `ENCRYPTION_KEY` | **Required** | — | AES-256-GCM for Strava + Garmin tokens at rest (`server/crypto.ts`). |
| `CSRF_SECRET` | Required in `production` | falls back to `ENCRYPTION_KEY` in dev/test | `csrf-csrf` middleware. |
| `TRUST_PROXY` | Optional | `"1"` | Express `app.set("trust proxy", …)` in `server/index.ts:78-83`. |
| `ALLOWED_ORIGINS` | Optional | — | CORS allow-list (`server/index.ts:212`). Localhost is always allowed. |

### Safety invariants (enforced at startup in `server/env.ts`)

- **Key separation**: `CSRF_SECRET` must differ from `ENCRYPTION_KEY` in every environment. If they match, the server refuses to boot.
- **Weak-key rejection**: A small set of obvious placeholder keys (all-zeros, `changeme_...`, the CI test key, etc.) is explicitly rejected in production via the `WEAK_ENCRYPTION_KEYS` list in `server/env.ts:11-17`.
- **Dev bypass lockout**: `ALLOW_DEV_AUTH_BYPASS=true` combined with `NODE_ENV=production` is a hard fatal — the server refuses to boot.
- **TRUST_PROXY is a three-valued enum**: `"0"` (off — use when Express is exposed directly, rare), `"1"` (trust exactly one hop, correct for Railway and most PaaS), or `"loopback"` (only local reverse proxies). Hardcoding `1` into other deployments where the number of trusted hops changes would let attacker-controlled `X-Forwarded-For` headers drive `req.ip`.

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

## AI (Google Gemini)

Get a free key at [aistudio.google.com](https://aistudio.google.com/). When `GEMINI_API_KEY` is unset, every AI feature (parsing, coaching, auto-coach, chat streaming, photo-to-workout) degrades gracefully.

| Variable | Req? | Default | Used by |
|---|---|---|---|
| `GEMINI_API_KEY` | Optional | — | All `@google/genai` calls. |
| `GEMINI_MODEL` | Optional | `gemini-2.5-flash-lite` | Default fast/cheap parsing model (free-text workout parse). |
| `GEMINI_SUGGESTIONS_MODEL` | Optional | `gemini-3.1-pro-preview` | Stronger model for auto-coach plan suggestions. |
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
| `RESEND_API_KEY` | Optional | — | Without it, the cron still runs but the send step is a no-op. |
| `RESEND_FROM_EMAIL` | Optional | — | `Display Name <address@example.com>` format. |

### Cron

| Variable | Req? | Default | Notes |
|---|---|---|---|
| `CRON_SECRET` | Optional | — | `GET /api/v1/cron/emails` requires `x-cron-secret` to match (timing-safe compare). Used by external cron (Railway / GitHub Actions) to hit the endpoint instead of relying on the in-process node-cron. |

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
| `VAPID_EMAIL` | Optional (required for push) | — | `mailto:` contact that push services (Google, Mozilla) reach on abuse reports. |

---

## Error Tracking (Sentry)

Sentry is fully optional. A missing DSN disables init without affecting anything else.

| Variable | Req? | Default | Who reads it |
|---|---|---|---|
| `SENTRY_DSN` | Optional | — | Server (`@sentry/node` in `server/index.ts`). |
| `VITE_SENTRY_DSN` | Optional | — | Client (`@sentry/react` in `client/src/main.tsx`). |

The Sentry `environment` tag is automatically derived from `NODE_ENV` on the server and from Vite's `MODE` on the client — there is no separate env var for it.

---

## Runtime & Dev

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test`. |
| `PORT` | `5000` | HTTP listener port. |
| `LOG_LEVEL` | `info` | Pino level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`. |
| `ALLOW_DEV_AUTH_BYPASS` | — | Dev-only. See [Authentication (Clerk)](#authentication-clerk). |

---

## Client (Vite) Variables

Variables exposed to browser code must start with `VITE_` — Vite statically inlines any `import.meta.env.VITE_*` at build time. Everything else is server-only.

| Variable | Source | Notes |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `.env` | Browser-safe Clerk key. Mirrors `CLERK_PUBLISHABLE_KEY`. |
| `VITE_SENTRY_DSN` | `.env` | Browser-safe Sentry DSN. Mirrors `SENTRY_DSN`. |
| `MODE` | Vite built-in | `development` \| `production` — used as Sentry environment tag. |
| `DEV` / `PROD` | Vite built-ins | Boolean guards used by `isDevPreview`, `RagDebugBadge`, etc. |

Do not put any server-only secret (including `CLERK_SECRET_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, or the VAPID private key) behind a `VITE_` prefix — it would leak into the public JS bundle.
