# Express Server Documentation

## Overview

The fitai.coach backend is an Express 4 REST API running on Node.js with TypeScript. It serves both the JSON API (under `/api/v1/`) and the Vite-built SPA client. Key technologies:

- **Express 4** -- HTTP framework
- **Drizzle ORM** with **node-postgres** (`pg`) -- primary database access
- **pgvector** on a separate (or shared) Neon PostgreSQL instance -- vector/RAG storage
- **pg-boss** -- PostgreSQL-backed job queue
- **node-cron** -- scheduled tasks
- **Clerk** -- authentication
- **Pino** -- structured logging
- **Helmet** -- security headers
- **csrf-csrf** -- CSRF protection (double-submit cookie pattern)
- **Sentry** -- error tracking
- **Zod** -- request validation and OpenAPI schema generation

Source entry point: `server/index.ts`

---

## Server Bootstrap

The startup sequence in `server/index.ts` proceeds as follows:

1. **Environment validation** -- `server/env.ts` is imported first. It parses `process.env` against a Zod schema and throws immediately on invalid configuration. A structured JSON boot log line is emitted to stdout before any validation runs.
2. **Dev auth bypass guard** -- If `ALLOW_DEV_AUTH_BYPASS` is `"true"` in production, the process exits with `logger.fatal`. In development it logs a warning.
3. **Sentry initialization** -- If `SENTRY_DSN` is set, `@sentry/node` is initialized with the current `NODE_ENV`. PII sending is disabled.
4. **Express + HTTP server creation** -- `express()` is created, `x-powered-by` is disabled, and a raw `http.Server` is created via `createServer(app)`.
5. **Core middleware wiring** -- Compression, the health endpoint, CORS, CSP/Helmet, body parsers, the cookie parser, request logging, and request-context wiring are registered in `server/index.ts` in deterministic order (see Middleware Stack below). App-level concerns (`trust proxy`, `x-powered-by`), the health endpoint, observability, and shutdown handlers are factored into `server/bootstrap/` (`appConfig.ts`, `health.ts`, `observability.ts`, `lifecycle.ts`). CSRF protection is mounted later inside `registerRoutes`; idempotency is applied per protected route.
6. **Health endpoint registration** -- `GET /api/v1/health` is registered before async startup tasks and before CORS so platform probes are always reachable.
7. **Early server bind** -- `httpServer.listen()` happens before startup tasks. This keeps `/api/v1/health` reachable while dependencies warm up.

After listening, startup advances through explicit phases exposed by the health endpoint's `phase` field:

8. **`db_maintenance` phase** -- `runStartupMaintenance(storage)` executes DB connectivity checks, migrations, schema/extension guards, and cleanup/backfill tasks.
9. **`queue` phase** -- `startQueue()` starts pg-boss and registers queue workers.
10. **`cron` phase** -- `startCron(storage)` schedules recurring jobs.
11. **`routes` phase** -- `registerRoutes(httpServer, app)` mounts auth + API routes.
12. **Post-route runtime wiring** -- Dev-only Swagger UI (`/api/docs`), global Express error handler, Sentry Express error handler, and static/Vite serving are attached.
13. **`ready` phase** -- `isReady` flips to `true`; health transitions from `starting` to `ok`.

If any phase throws, `startupError` is set, the process stays bound, and `/api/v1/health` returns `503` with `{ status: "error", phase, ... }`.

---

## Middleware Stack

Middleware is applied in the following order in `server/index.ts`:

| Order | Middleware | Description |
|-------|-----------|-------------|
| 1 | `compression({ filter })` | Gzip/Brotli response compression. **Skipped for `text/event-stream` responses** so streaming chat is not held in the compression buffer. |
| 2 | Health check route | `GET /api/v1/health` -- registered **before CORS** so platform healthchecks (requests with no `Origin` header) always reach it. |
| 3 | `cors()` | CORS with origin allowlist (see below) |
| 4 | `cspNonceMiddleware` | Per-request CSP nonce generation (production only) |
| 5 | `helmet()` | Security headers (CSP baseline, HSTS with preload, referrer policy, etc.) |
| 6 | Custom CSP override | Replaces Helmet's CSP with a per-request nonce-based policy |
| 7 | `Permissions-Policy` | Sets `camera=(), microphone=(self), geolocation=()` |
| 8 | `express.json({ limit: "2mb" })` | Body parsing for `/api/v1/coaching-materials` only |
| 9 | `express.json({ limit: "10mb" })` | Body parsing for image-parse routes only (base64 image payloads; matched via `isImageParsePath`) |
| 10 | `express.json({ limit: "100kb" })` | Default JSON body parsing with raw body capture |
| 11 | `express.urlencoded()` | URL-encoded body parsing (100 kb limit) |
| 12 | `cookieParser()` | Cookie parsing -- required by the CSRF double-submit middleware mounted in `registerRoutes` |
| 13 | `pino-http` | Structured request logging with request ID and user context |
| 14 | request-context wiring | Runs the remainder of the request inside an async context carrying `requestId`/`userId` for logging |

CSRF protection and idempotency are **not** part of this global chain. `csrfProtection` is mounted on `/api/v1` inside `registerRoutes()`; idempotency is applied per protected mutating route through the `protectedRouteBuilder` guards (`protectedMutationGuards = [isAuthenticated, idempotencyMiddleware]`).

### Middleware Ordering Rationale

Middleware is ordered intentionally:
1. **compression** first -- compresses all responses including error pages, **except** `text/event-stream` responses. `compression`'s internal gzip buffer holds chunks indefinitely when the producer is slow (e.g. Gemini with `thinkingLevel: HIGH`), which breaks SSE. The filter in `server/index.ts` checks `res.getHeader("Content-Type")` for `text/event-stream` and falls through to `compression.filter` for everything else.
2. **CORS** early -- rejects disallowed origins before any processing
3. **CSP nonce + Helmet** before route handlers -- security headers on every response
4. **Custom CSP override** -- refines Helmet defaults with Clerk domains and nonce
5. **Body parsing** after security -- limits apply to parsed bodies only
6. **pino-http** then **request-context** last in the pre-route stack -- logs after auth context is available (extracts userId from Clerk)

### CORS allowed origins

- `APP_URL` (from environment)
- `https://fitai.coach`
- Any origins listed in `ALLOWED_ORIGINS` (comma-separated)
- `http://localhost:5000` and `http://localhost:5173` (development only)

Same-origin requests (no `Origin` header) are always allowed. Credentials are enabled.

---

## Route Registration

`server/routes.ts` exports `registerRoutes(httpServer, app)` which performs:

1. **Clerk auth setup** -- `setupAuth(app)` from `server/clerkAuth.ts`
2. **CSRF token endpoint** -- `GET /api/v1/csrf-token` is mounted before the protecting middleware so the safe-method request can set the cookie.
3. **CSRF protection** -- `app.use("/api/v1", csrfProtection)` guards every mutating `/api/v1` request.
4. **Strava + Garmin OAuth routes** -- `registerStravaRoutes(app)` from `server/strava.ts` and `registerGarminRoutes(app)` from `server/garmin.ts`.
5. **API route modules** -- Each mounted via `app.use(router)`:

| Module | File |
|--------|------|
| Account | `server/routes/account.ts` |
| Auth | `server/routes/auth.ts` |
| Preferences | `server/routes/preferences.ts` |
| Email | `server/routes/email.ts` |
| AI | `server/routes/ai.ts` |
| Analytics | `server/routes/analytics.ts` |
| Workouts | `server/routes/workouts/` (composite router in `index.ts` over the CRUD, AI, export, migration, and timeline sub-route modules) |
| Plans | `server/routes/plans.ts` |
| Coaching | `server/routes/coaching.ts` |
| Push | `server/routes/push.ts` |
| Timeline annotations | `server/routes/timelineAnnotations.ts` |

All API routes are prefixed with `/api/v1/` by convention within each router file.

Protected mutating endpoints are declared with the `protectedRouteBuilder` helpers (`protectedPost` / `protectedPatch` / `protectedDelete`) in `server/routes/_helpers/`. The builder applies a canonical guard order -- auth + idempotency (`protectedMutationGuards`), rate limiter, AI consent/budget (when enabled), validation, then the async handler. A compliance test in `server/routes/__tests__/` fails CI if a protected mutation bypasses the builder.

Route handlers follow a **thin controller** pattern -- they validate input, then delegate to a use-case or service function. For workouts, `server/services/workoutUseCases.ts` provides a use-case layer that splits route payloads into service-level arguments; newer use cases also live under `server/usecases/`.

---

## Security

### Helmet

Helmet is configured with a baseline CSP that is immediately overridden by a custom middleware to support per-request nonces. Additional settings:

- `crossOriginEmbedderPolicy: false`
- `referrerPolicy: "strict-origin-when-cross-origin"`
- `x-powered-by` header disabled on the Express app directly

### CSP Nonces

In production, `server/middleware/cspNonce.ts` generates a 128-bit random nonce (base64-encoded) per request, stored in `res.locals.cspNonce`. The nonce is injected into the `script-src` CSP directive and into `<script>` tags in the served HTML (see `server/static.ts`). In development, `'unsafe-inline'` and `'unsafe-eval'` are used instead.

### CORS

A strict origin whitelist is enforced. Requests from unlisted origins receive a CORS error. See the allowed origins table above.

### Rate Limiting

`server/routeUtils.ts` exports a `rateLimiter(category, maxRequests, windowMs)` factory. Key properties:

- Per-user keying (falls back to IP for unauthenticated requests), namespaced by category
- Default window: 60 seconds (`DEFAULT_RATE_LIMIT_WINDOW_MS`)
- Standard `RateLimit-*` headers (RFC 6585)
- Returns `429` with `Retry-After` header and `RATE_LIMITED` error code
- Limiter instances are cached per `(category, maxRequests, windowMs)` tuple
- Uses PostgreSQL-backed `rate_limit_buckets` outside tests so limits are shared across app replicas
- The SPA fallback route in `server/static.ts` has its own rate limiter (100 requests per 15 minutes)

### Body Size Limits

- `/api/v1/coaching-materials`: 2 MB (coaching documents can be large)
- All other routes: 100 KB for both JSON and URL-encoded bodies

### Request ID Validation

Client-supplied `X-Request-ID` headers are validated against the pattern `^[\w.:-]+$` with a 64-character maximum length to prevent log injection. Invalid or missing IDs are replaced with a `randomUUID()`.

### CSRF Protection

**File:** `server/middleware/csrf.ts`

CSRF protection uses the **double-submit cookie pattern** via the `csrf-csrf` library. This prevents cross-site request forgery on all state-changing endpoints.

**Flow:**

1. Client calls `GET /api/v1/csrf-token` (safe method, exempt from verification). The server sets a signed `__Host-fitai.x-csrf` cookie (production) or `fitai.x-csrf` cookie (development) and returns the paired token in JSON.
2. Client attaches the token as the `x-csrf-token` header on all mutating requests (POST/PUT/PATCH/DELETE).
3. The `csrfProtection` middleware verifies the header matches the cookie HMAC before forwarding the request.

**Session binding:** The CSRF token is bound to the Clerk `userId` when authenticated, so tokens issued pre-login are invalidated after sign-in and tokens cannot be replayed across users. Falls back to client IP for the pre-login window.

**Configuration:**

- Cookie: `httpOnly: true`, `sameSite: "strict"`, `secure: true` (production)
- Secret: `CSRF_SECRET` env var. **Required in production** and **must differ from `ENCRYPTION_KEY`** — both invariants are enforced at startup by `server/env.ts` Zod `.refine()` guards that abort boot with `❌ FATAL:` messages. When unset in dev/test, `resolveCsrfSecret()` generates a random per-process secret (it is **not** aliased to `ENCRYPTION_KEY`). See [Authentication → Key Separation](authentication.md#key-separation-csrf_secret-vs-encryption_key).
- Safe methods (GET/HEAD/OPTIONS) are exempt from verification

### Idempotency Middleware

**File:** `server/middleware/idempotency.ts`

Server-side enforcement for the `X-Idempotency-Key` header sent by the client's offline queue on replay.

**Behavior:**

- Applies to mutating methods only (POST/PUT/PATCH/DELETE)
- Requests without the header pass through untouched
- On first request with a given `(userId, key)` pair, the response is cached in the `idempotency_keys` table with a 7-day TTL
- On repeat requests with the same key, the cached response (status code + body) is returned without re-executing the handler
- Key length is capped at 255 characters (returns 400 if exceeded)
- Must be mounted after `isAuthenticated` so `getUserId()` can resolve the caller
- Storage failures are logged and the request proceeds without idempotency guarantees (graceful degradation)

### Dev Auth Bypass Guard

`ALLOW_DEV_AUTH_BYPASS=true` causes an immediate `process.exit(1)` if `NODE_ENV` is `"production"`. This is enforced both by the Zod schema refinement in `server/env.ts` and by a runtime check in `server/index.ts`.

### Error Sanitization

The global error handler returns generic `"Internal Server Error"` messages for 500-status errors. Error details (`err.details`) are only included in the response for non-500 errors. All errors are reported to Sentry.

### Error Handling Flow

```mermaid
sequenceDiagram
    participant Client
    participant Express
    participant Handler as Route Handler
    participant Sentry
    
    Client->>Express: API Request
    Express->>Handler: After middleware
    Handler-->>Express: throw Error(status, message)
    Express->>Sentry: captureException(err)
    alt status < 500
        Express->>Client: { error: err.message, code, details }
    else status >= 500
        Express->>Client: { error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" }
    end
```

---

## Logging

Structured logging is provided by **Pino** (`server/logger.ts`).

### Configuration

- Log level is set via `LOG_LEVEL` environment variable (default: `"info"`)
- Sensitive headers are redacted: `authorization`, `cookie`, `x-cron-secret`
- In development, `pino-pretty` is used for human-readable colorized output
- In production, raw JSON is emitted (suitable for log aggregation)

### pino-http Middleware

The `pino-http` middleware adds structured context to every request log:

- **requestId** -- from validated `X-Request-ID` header or generated UUID
- **userId** -- extracted from Clerk auth (falls back to `"anonymous"`)
- **route** -- the request URL path (query string stripped)
- **context** -- set to `"http"`

Auto-logging is filtered to API routes only (`req.url` starting with `/api/v1`). Non-API requests (static assets, SPA fallback) are not logged by pino-http.

---

## Graceful Shutdown

`server/index.ts` wires `registerShutdownHandlers()` (`server/bootstrap/lifecycle.ts`) for `SIGTERM` and `SIGINT`. The shutdown sequence:

1. **Force-exit timer** -- A 60-second timeout (`SHUTDOWN_TIMEOUT_MS`) is set. If graceful shutdown does not complete within this window, `process.exit(1)` is called. The timer is `unref()`-ed so it does not keep the event loop alive.

2. **Stop cron** -- `stopCron()` halts the `node-cron` scheduler.

3. **Drain SSE streams** -- `drainSseStreams()` closes in-flight Server-Sent Events connections (e.g. coach chat) with a 5-second grace window.

4. **Close HTTP server** -- `httpServer.close()` stops accepting new connections and waits for existing connections to drain.

5. **Stop queue** -- `queue.stop()` shuts down the pg-boss job queue.

6. **Drain database pools** -- `pool.end()` (main DB) and `vectorPool.end()` (vector DB) are called in parallel.

7. **Flush Sentry** -- `Sentry.close()` flushes buffered events with a 10-second timeout.

8. **Exit** -- `process.exit(0)` on success, `process.exit(1)` on error.

### Health Check Lifecycle

- `isReady` starts as `false`, `startupError` as `null`
- Server listens on port BEFORE routes register (allows health check during startup)
- `GET /api/v1/health` returns `{ status: "starting" }` while bootstrapping
- After `registerRoutes()` completes, `isReady = true` -- returns `{ status: "ok" }`
- If startup throws, `startupError` is set -- returns `{ status: "error", error: "..." }` with 503
- CI tools (wait-on) poll this endpoint to know when the server is ready

---

## Swagger / OpenAPI

In development only (`NODE_ENV !== "production"`), Swagger UI is served at `/api/docs`.

- The OpenAPI document is generated by `generateOpenApiDocument()` from `shared/openapi.ts`, which uses `zod-to-openapi` to derive schemas from Zod types.
- A relaxed CSP is applied to the Swagger UI route (`unsafe-inline` for scripts and styles).
- The Swagger top bar is hidden via custom CSS.
- The page title is set to "Workout API Documentation".

This endpoint is deliberately blocked in production to avoid exposing the full API schema and to prevent the need for a relaxed CSP.

---

## Environment Variables

All environment variables are validated at startup by a Zod schema in `server/env.ts`. The validated object is exported as `env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (main database) |
| `ENCRYPTION_KEY` | Yes | Minimum 32 characters, used for encrypting sensitive data |
| `NODE_ENV` | No | `"development"` (default), `"production"`, or `"test"` |
| `PORT` | No | Server listen port (default: `"5000"`) |
| `CLERK_PUBLISHABLE_KEY` | No | Clerk frontend key |
| `CLERK_SECRET_KEY` | No | Clerk backend key |
| `SENTRY_DSN` | No | Sentry error tracking DSN |
| `RESEND_API_KEY` | No | Resend email delivery API key (email disabled if unset) |
| `RESEND_FROM_EMAIL` | No | Sender address for outbound emails |
| `VAPID_PUBLIC_KEY` | No | Web Push VAPID public key (push endpoints return 404 if unset) |
| `VAPID_PRIVATE_KEY` | No | Web Push VAPID private key |
| `VAPID_EMAIL` | No | Contact `mailto:` address for Web Push |
| `AI_FEATURES_ENABLED` | No | Runtime kill switch for AI provider traffic (default `true`; `false` disables all AI features) |
| `AI_TEXT_PROVIDER` | No | Text AI provider (`gemini`, `anthropic`, or `openai-compatible`; default `gemini`) |
| `AI_TEXT_MODEL` | No | Default text model override for the configured provider |
| `AI_TEXT_FAST_MODEL` | No | Fast text model override for parsing-style calls |
| `AI_TEXT_REASONING_MODEL` | No | Reasoning text model override for coaching and plan generation |
| `AI_TEXT_REASONING_EFFORT` | No | Reasoning effort hint (`none`, `low`, `medium`, `high`; default `high`) |
| `AI_TEXT_API_KEY` | No | Generic API key for non-Gemini text providers |
| `AI_TEXT_OPENAI_COMPATIBLE_PROFILE` | No | OpenAI-compatible profile (`openai`, `xai`, `groq`, `together`, `openrouter`, `deepseek`, or `custom`) |
| `AI_TEXT_BASE_URL` | No | Base URL for OpenAI-compatible providers |
| `GEMINI_API_KEY` | No | Gemini key for the Gemini text provider, RAG embeddings, and image parsing |
| `CRON_SECRET` | No | Secret for authenticating external cron triggers |
| `INTERNAL_ANALYTICS_SECRET` | No | Secret for authenticating internal analytics health endpoints |
| `APP_INSTANCE_COUNT` | No | Declared app replica count (default `1`). Values above `1` are supported after migrations because rate limits/cache state are shared through Postgres. |
| `STRAVA_CLIENT_ID` | No | Strava OAuth client ID |
| `STRAVA_CLIENT_SECRET` | No | Strava OAuth client secret |
| `STRAVA_STATE_SECRET` | No | Secret for signing Strava OAuth state tokens |
| `APP_URL` | No | Public application URL (used for CORS, OAuth callbacks) |
| `ALLOWED_ORIGINS` | No | Comma-separated list of additional CORS origins |
| `TRUST_PROXY` | No | Express `trust proxy` setting for client IP derivation (default `1`) |
| `VECTOR_DATABASE_URL` | No | Separate Neon PostgreSQL URL for vector storage; falls back to `DATABASE_URL` |
| `ALLOW_DEV_AUTH_BYPASS` | No | Set to `"true"` to bypass auth in development (fatal in production) |
| `LOG_LEVEL` | No | Pino log level (default: `"info"`) |
| `RAG_CHUNK_SIZE` | No | Character count per RAG chunk (default: `600`) |
| `RAG_CHUNK_OVERLAP` | No | Overlap characters between RAG chunks (default: `100`) |
| `CSRF_SECRET` | Yes (production) | Minimum 32 characters, used for CSRF token HMAC. In production it is **required** and **must differ** from `ENCRYPTION_KEY`. Auto-generated per process in dev/test if unset. |

This table covers the variables most relevant to the server runtime. It is not exhaustive -- see [Environment Variables](env-reference.md) for the complete reference, including AI model overrides and feature flags.

---

## Key Configuration

### Database Pools

**Main pool** (`server/db.ts`):
- Connection string: `DATABASE_URL`
- Max connections: 20
- Idle timeout: 30 s (`DB_IDLE_TIMEOUT_MS`)
- Connection timeout: 5 s (`DB_CONNECTION_TIMEOUT_MS`)
- Statement timeout: 30 s (`DB_STATEMENT_TIMEOUT_MS`)
- **SSL selection:** Enabled in production (`rejectUnauthorized: true`) **unless** the `DATABASE_URL` hostname ends in `.railway.internal`. Railway's internal Postgres network stays on private IPv6 and does not speak SSL, so forcing TLS on an internal-host URL breaks connections. The hostname is parsed via `new URL(env.DATABASE_URL)` with a try/catch fallback.
- Drizzle ORM wraps the pool with the shared schema

**Vector pool** (`server/vectorDb.ts`):
- Connection string: `VECTOR_DATABASE_URL` (falls back to `DATABASE_URL`)
- Max connections: 5
- Idle timeout: 30 s
- Connection timeout: 10 s (`VECTOR_DB_CONNECTION_TIMEOUT_MS`)
- Statement timeout: 30 s
- Used for `pgvector` similarity search on document chunks

Both pools log unexpected errors on idle clients.

### Job Queue

pg-boss (`server/queue.ts`) is initialized with the `DATABASE_URL` connection string. Four queues are registered:

| Queue | Worker | Description |
|-------|--------|-------------|
| `auto-coach` | `triggerAutoCoach(userId)` | Runs AI-driven coaching adjustments for a user |
| `embed-coaching-material` | `embedCoachingMaterial(material)` | Generates and stores vector embeddings for coaching documents |
| `send-weekly-summary` | `processWeeklySummary(...)` | Sends one user's weekly training summary email |
| `send-missed-reminder` | `processMissedWorkoutReminder(...)` | Sends one user's missed-workout reminder email |

Idempotent jobs use `DEFAULT_JOB_OPTIONS` (retry 3× with exponential backoff); the email send jobs use `NO_RETRY_JOB_OPTIONS`, because the "sent" marker is persisted after delivery and a retry would duplicate the email. Each job runs under a 50-minute wall-clock timeout, and in-batch parallelism is bounded to 2. Failed jobs are re-thrown to let pg-boss handle retries.

### Cron Scheduling

`server/cron.ts` uses `node-cron` for in-process scheduled tasks. Each cron body is wrapped in a PostgreSQL advisory lock so duplicate schedulers skip work instead of running the same maintenance job twice.

| Job | Schedule | Lock |
|---|---|---|
| Email check | Daily at 09:00 UTC | `dailyEmail` |
| Idempotency cleanup | Daily at 03:30 UTC | `idempotencyCleanup` |
| AI usage cleanup | Daily at 04:00 UTC | `aiUsageCleanup` |
| Shared runtime state cleanup | Daily at 04:15 UTC | `sharedRuntimeCleanup` |
| Stale auto-coach recovery | Every 10 minutes | `staleAutoCoaching` |
| pg-boss queue-depth telemetry | Every 5 minutes | `queueDepthTelemetry` |
| Structured exercise health rollup | Daily at 02:10 UTC | `structuredExerciseRollup` |
| Startup email catch-up | 30 seconds after late startup | `startupEmailCatchUp` |

Cron jobs run in-process on each app replica, but each job body is wrapped in a PostgreSQL advisory lock so only one replica performs the work. Rate limits use `rate_limit_buckets`, while the Clerk seen-cache and AI/RAG hot caches use `server_runtime_cache`, so `APP_INSTANCE_COUNT > 1` no longer weakens abuse prevention or provider-spend cache behavior.

### Shared Runtime State

`server/sharedRuntimeState.ts` owns short-lived shared cache helpers backed by Postgres:

- `rate_limit_buckets` stores per-category request counters and reset timestamps for `rateLimiter(...)`.
- `server_runtime_cache` stores hashed short-lived keys for the Clerk auth seen-cache, Gemini embedding cache, RAG retrieval cache, and embedding health probe.
- Expired rows are pruned daily by the `sharedRuntimeCleanup` cron job at 04:15 UTC.

### Route Utilities

`server/routeUtils.ts` provides shared utilities used across route modules:

- `rateLimiter(category, max, windowMs)` -- per-route rate limiting factory
- `validateBody(schema)` -- Zod-based request body validation middleware
- `asyncHandler(fn)` -- wraps async route handlers with error forwarding to `next(err)`
- `formatValidationErrors(error)` -- formats Zod errors into safe client-facing messages
- `calculateStreak(completedDates)` -- calculates consecutive workout day streaks

### Static File Serving

In production (`server/static.ts`):

- `/assets/*` is served with `Cache-Control: max-age=1y, immutable` (fingerprinted build artifacts)
- Other static files are served with `max-age=0` and no index
- The SPA fallback (`*`) reads `index.html` once at startup and injects the per-request CSP nonce into all `<script>` tags
- The fallback route is rate-limited to 100 requests per 15-minute window

---

See also: [Authentication](authentication.md), [Database -- Storage Layer](database.md#storage-layer), [Architecture -- Request Lifecycle](architecture.md#request-lifecycle)
