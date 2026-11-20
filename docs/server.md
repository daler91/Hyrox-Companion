# Express Server Documentation

## Overview

The fitai.coach backend is an Express 5 REST API running on Node.js with TypeScript. It serves both the JSON API (under `/api/v1/`) and the Vite-built SPA client. Key technologies:

- **Express 5** -- HTTP framework
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

1. **Environment validation** -- `server/env.ts` is imported first. Before any validation runs it writes a plain-text `[env] Validating environment pid=… at=…` line to stderr (the pino logger does not exist yet). It then parses `process.env` against a Zod schema and throws immediately on invalid configuration, after writing the formatted errors to stderr and a structured JSON `fatal` line to stdout.
2. **Dev auth bypass guard** -- If `ALLOW_DEV_AUTH_BYPASS` is `"true"` in production, the process exits with `logger.fatal`. In development it logs a warning.
3. **Sentry initialization** -- If `SENTRY_DSN` is set, `@sentry/node` is initialized with the current `NODE_ENV`. PII sending is disabled.
4. **Express + HTTP server creation** -- `express()` is created, `x-powered-by` is disabled, and a raw `http.Server` is created via `createServer(app)`.
5. **Core middleware wiring** -- Compression, the health endpoint, CORS, CSP/Helmet, body parsers, the cookie parser, request logging, and request-context wiring are registered in `server/index.ts` in deterministic order (see Middleware Stack below). App-level concerns (`trust proxy`, `x-powered-by`), the health endpoint, observability, and shutdown handlers are factored into `server/bootstrap/` (`appConfig.ts`, `health.ts`, `observability.ts`, `lifecycle.ts`). CSRF protection is mounted later inside `registerRoutes`; idempotency is applied per protected route.
6. **Health endpoint registration** -- `GET /api/v1/health` (readiness) and `GET /api/v1/health/live` (liveness) are registered before async startup tasks and before CORS so platform probes are always reachable. `GET /.well-known/assetlinks.json` is registered in the same place (see Middleware Stack below).
7. **Early server bind** -- `httpServer.listen()` happens before startup tasks. This keeps `/api/v1/health` reachable while dependencies warm up.

After listening, startup advances from the initial `initializing` phase through explicit phases exposed by the health endpoint's `phase` field:

8. **`ssrf_guard` phase** (only when `AI_TEXT_BASE_URL` is set) -- `assertResolvedHostIsPublic(env.AI_TEXT_BASE_URL)` resolves the host and aborts startup if it resolves to a private/loopback address (see [SSRF Guard](#ssrf-guard)).
9. **`db_maintenance` phase** -- `runStartupMaintenance(storage)` executes DB connectivity checks, migrations, schema/extension guards, and cleanup/backfill tasks.
10. **`queue` phase** -- `startQueue()` starts pg-boss and registers the workers defined in `server/queue.ts`; `registerStravaAutoSyncWorker()` (`server/services/stravaAutoSync.ts`) then registers the `strava-sync` worker, and `registerSessionStreamWorker()` (`server/services/sessionStreamSync.ts`) the `session-streams` worker.
11. **`cron` phase** -- `startCron(storage)` schedules recurring jobs, and a warning is logged if `RESEND_API_KEY` is unset.
12. **`routes` phase** -- `registerRoutes(httpServer, app)` mounts auth + API routes.
13. **Post-route runtime wiring** -- Dev-only Swagger UI (`/api/docs`), global Express error handler, Sentry Express error handler, and static/Vite serving are attached.
14. **`ready` phase** -- `isReady` flips to `true`; health transitions from `starting` to `ok` (or `degraded` when a database probe fails).

If any phase throws, `startupError` is set, the process stays bound, and `/api/v1/health` returns `503` with `{ status: "error", phase, ... }`.

---

## Middleware Stack

Middleware is applied in the following order in `server/index.ts`:

| Order | Middleware | Description |
|-------|-----------|-------------|
| 1 | `compression({ filter })` | Gzip/Brotli response compression. **Skipped for `text/event-stream` responses** so streaming chat is not held in the compression buffer. |
| 2 | Health check route | `GET /api/v1/health` -- registered **before CORS** so platform healthchecks (requests with no `Origin` header) always reach it. |
| 3 | Asset Links route | `GET /.well-known/assetlinks.json` (`registerWellKnownRoutes()` in `server/bootstrap/wellKnown.ts`) -- the Android app's Digital Asset Links, built from `ANDROID_APP_PACKAGE` and `ANDROID_APP_CERT_SHA256` and cached for an hour; a `404` when they are unset. Registered **before CORS**, auth and the SPA fallback, because `express.static` ignores dot-directories and the fallback would otherwise answer with `index.html`. |
| 4 | `cors()` | CORS with origin allowlist (see below) |
| 5 | `cspNonceMiddleware` | Per-request CSP nonce generation (production only) |
| 6 | `helmet()` | Security headers, including the full **Content-Security-Policy** (per-request nonce) built by `buildCspDirectives()` in `server/middleware/csp.ts`, plus HSTS with preload and referrer policy. |
| 7 | `permissionsPolicy` | Sets `Permissions-Policy: camera=(self), microphone=(self), geolocation=()` (`server/middleware/permissionsPolicy.ts`): the camera and microphone for the app's own origin only (the nutrition barcode scanner and voice dictation), geolocation off |
| 8 | `express.json({ limit: "100kb" })` | Default JSON body parsing with raw body capture, wrapped in `skipLargeJsonBodyPaths()`. The few routes that take a larger body (plan import, coaching materials, chat sends, image parses) are skipped here and parsed inside their protected route stack, after auth and the rate limiter -- see [Body Size Limits](#body-size-limits) |
| 9 | `express.urlencoded()` | URL-encoded body parsing (100 kb limit) |
| 10 | `cookieParser()` | Cookie parsing -- required by the CSRF double-submit middleware mounted in `registerRoutes` |
| 11 | `pino-http` | Structured request logging with request ID. Runs before Clerk auth, so user identity is limited (see [pino-http Middleware](#pino-http-middleware)) |
| 12 | request-context wiring | Runs the remainder of the request inside an async context carrying `requestId` only -- Clerk auth has not run yet at this point |

Clerk auth, CSRF protection and idempotency are **not** part of this global chain. `clerkMiddleware()` is installed by `setupAuth()` (when Clerk keys are configured) at the start of `registerRoutes()`, and `csrfProtection` is mounted on `/api/v1` after it; idempotency is applied per protected mutating route through the `protectedRouteBuilder` guards (`protectedMutationGuards = [isAuthenticated, idempotencyMiddleware]`).

### Middleware Ordering Rationale

Middleware is ordered intentionally:
1. **compression** first -- compresses all responses including error pages, **except** `text/event-stream` responses. `compression`'s internal gzip buffer holds chunks indefinitely when the producer is slow (e.g. Gemini with `thinkingLevel: HIGH`), which breaks SSE. The filter in `server/index.ts` checks `res.getHeader("Content-Type")` for `text/event-stream` and falls through to `compression.filter` for everything else.
2. **CORS** early -- every later response, error responses included, carries the CORS headers for an allowed origin. A disallowed origin is not rejected: its request is still processed, but the response carries no `Access-Control-Allow-Origin`, so the browser refuses to hand it to the calling page
3. **CSP nonce + Helmet** before route handlers -- security headers (including the nonce-based CSP from `buildCspDirectives()`) on every response
4. **Body parsing** after security -- limits apply to parsed bodies only
5. **pino-http** then **request-context** last in the pre-route stack -- both run **before** Clerk auth (`clerkMiddleware()` is registered later, inside `registerRoutes()`), so `req.log` is bound with `userId: "anonymous"` and the request context carries `requestId` only

### CORS allowed origins

- `APP_URL` (from environment)
- `https://fitai.coach`
- Any origins listed in `ALLOWED_ORIGINS` (comma-separated)
- `http://localhost:5000` and `http://localhost:5173` (whenever `NODE_ENV` is not `production`)

Requests with no `Origin` header (same-origin and server-to-server requests) are always allowed. Credentials are enabled.

---

## Route Registration

`server/routes.ts` exports `registerRoutes(httpServer, app)` which performs:

1. **Clerk auth setup** -- `setupAuth(app)` from `server/clerkAuth.ts`
2. **Native app version gate** -- `app.use("/api/v1", appVersionGate)` from `server/middleware/appVersion.ts`. The mobile app sends `X-App-Platform` and `X-App-Version` on every request; once `MIN_APP_VERSION_ANDROID` or `MIN_APP_VERSION_IOS` is set, a build older than that minimum, or one whose version is missing or malformed, is answered `426` with code `APP_UPDATE_REQUIRED`. It mounts first so an outdated build sees its update prompt rather than whatever auth or CSRF error it would trip over. Requests without a recognised platform header (the web app, Strava's webhook) pass untouched.
3. **CSRF token endpoint** -- `GET /api/v1/csrf-token` is mounted before the protecting middleware so the safe-method request can set the cookie.
4. **CSRF protection** -- `app.use("/api/v1", csrfProtection)` guards every mutating `/api/v1` request. Two exceptions mount just before it, because their callers send neither a session cookie nor a CSRF token. The first, `registerStravaWebhookRoutes(app)` from `server/stravaWebhook.ts`, registers `GET`/`POST /api/v1/strava/webhook`, which Strava calls without a token (see [Integrations → Automatic Sync](integrations.md#automatic-sync)). The second, `registerEmailUnsubscribeRoutes(app)` from `server/routes/emailUnsubscribe.ts`, registers `GET`/`POST /api/v1/emails/unsubscribe`, which mail clients POST to for one-click unsubscribe and which is authorised by its signed token alone (see [Integrations → One-Click Unsubscribe](integrations.md#one-click-unsubscribe)).
5. **Training-context invalidation** -- `app.use("/api/v1", invalidateTrainingContextOnWrite)` from `server/services/trainingContextCache.ts`. Once a write (`POST`/`PUT`/`PATCH`/`DELETE`) outside `/chat` has answered with a status below 400, the athlete's cached coach-chat training context is dropped.
6. **Strava + Garmin OAuth routes** -- `registerStravaRoutes(app)` from `server/strava.ts` and `registerGarminRoutes(app)` from `server/garmin.ts`.
7. **API route modules** -- Each mounted via `app.use(router)`:

Listed in mount order:

| Module | File |
|--------|------|
| Account | `server/routes/account.ts` |
| Auth | `server/routes/auth.ts` |
| Preferences | `server/routes/preferences.ts` |
| Email | `server/routes/email.ts` |
| AI | `server/routes/ai.ts` |
| Analytics | `server/routes/analytics.ts` |
| Session grades | `server/routes/sessionGrades.ts` |
| Workouts | `server/routes/workouts/` (composite router in `index.ts` over the CRUD, AI, device-link, timeline, export, MAF, and migration sub-route modules) |
| Plans | `server/routes/plans.ts` |
| Plan recovery | `server/routes/planRecovery.ts` |
| Plan proposals | `server/routes/planProposals.ts` |
| Coaching | `server/routes/coaching.ts` |
| Consent | `server/routes/consent.ts` |
| Push | `server/routes/push.ts` |
| Health Connect | `server/routes/healthConnect.ts` |
| Timeline annotations | `server/routes/timelineAnnotations.ts` |
| Athlete facts (the athlete card) | `server/routes/athleteFacts.ts` |
| Recycle bin | `server/routes/recycleBin.ts` |
| Nutrition | `server/routes/nutrition/` (composite router: `index.ts` mounts the `NUTRITION_ENABLED` 404 gate, then `nutrition.routes.ts` registers the foods, favorites, logs, summary, parse, targets, insights, and recipes sub-route modules) |

All API routes are prefixed with `/api/v1/` by convention within each router file.

Protected mutating endpoints are declared with the `protectedRouteBuilder` helpers (`protectedPost` / `protectedPatch` / `protectedDelete`) in `server/routes/_helpers/`. The builder applies a canonical guard order -- auth + idempotency (`protectedMutationGuards`), rate limiter, the large-body JSON parser (`largeJsonBodyParser`, a no-op on every other path), AI consent/budget (when enabled), validation, then the async handler. A compliance test in `server/routes/__tests__/` fails CI if a protected mutation bypasses the builder.

Route handlers follow a **thin controller** pattern -- they validate input, then delegate to a use-case or service function. For workouts, `server/services/workoutUseCases.ts` provides a use-case layer that splits route payloads into service-level arguments; newer use cases also live under `server/usecases/`.

---

## Security

### Helmet

Helmet is configured with the application's full Content-Security-Policy via `buildCspDirectives()` (`server/middleware/csp.ts`), including a per-request nonce in `script-src` (production). `useDefaults` is `false`, so the emitted policy is exactly those directives. Additional settings:

- `img-src` includes `blob:`, so photo previews built with `URL.createObjectURL` render (a `blob:` URL never matches `'self'`)
- `style-src` keeps `'unsafe-inline'`: Recharts injects `<style>` tags and Radix UI sets inline `style` attributes
- `frame-ancestors 'none'`, and `upgrade-insecure-requests` in production only
- `strictTransportSecurity`: one year (`maxAge: 31536000`), `includeSubDomains`, `preload`
- `crossOriginEmbedderPolicy: false`
- `referrerPolicy: "strict-origin-when-cross-origin"`
- `x-powered-by` header disabled on the Express app directly

### CSP Nonces

In production, `server/middleware/cspNonce.ts` generates a 128-bit random nonce (base64url-encoded, so it never contains `+`, `/` or `=`) per request, stored in `res.locals.cspNonce`. The nonce is injected into the `script-src` CSP directive and into `<script>` tags in the served HTML (see `server/static.ts`). Outside production the nonce middleware is not mounted; `script-src` uses `'unsafe-inline'` and `'unsafe-eval'` instead, and `connect-src` adds `ws:` and `wss:` for Vite HMR.

### CORS

A strict origin allowlist is enforced. The `origin` callback in `server/index.ts` answers `callback(null, false)` for an unlisted origin: the server raises no error and still processes the request, but sends no CORS headers, so the browser blocks the calling page from reading the response, and its preflight fails, so a request that needs one is never sent. See the allowed origins list above.

### Rate Limiting

`server/routeUtils.ts` exports a `rateLimiter(category, maxRequests, windowMs)` factory. Key properties:

- Per-user keying (falls back to IP for unauthenticated requests), namespaced by limiter: the bucket key is `${category}:${maxRequests}:${windowMs}:user:${id}` (or `:ip:`), so two limiters that share a category but not a cap or window keep separate counters
- Default window: 60 seconds (`DEFAULT_RATE_LIMIT_WINDOW_MS`)
- Standard `RateLimit-*` headers (`standardHeaders: true`); the legacy `X-RateLimit-*` headers are off
- Returns `429` with `Retry-After` header and `RATE_LIMITED` error code
- Limiter instances are cached per `(category, maxRequests, windowMs)` tuple, one fail-open and one fail-closed instance each (see below)
- A request with neither a user id nor an IP (`req.ip`) is not rate-limited
- Uses PostgreSQL-backed `rate_limit_buckets` outside tests so limits are shared across app replicas
- **Store-error behaviour is split by method** (`passOnStoreError` is chosen per request in `server/routeUtils.ts`): safe methods (`GET`, `HEAD`, `OPTIONS`) fail **open**, so a Postgres blip cannot 500 the entire read surface; everything else — every mutation, and therefore every auth, AI-spend and write route — fails **closed**, where allowing unthrottled requests during a store outage is the bigger risk. An attacker cannot defeat the limiter on a mutating route by inducing store errors. Counts stay unified per limiter because both instances share the same Postgres key.
- Every authenticated `/api/v1` route carries a limiter, including plain reads such as `GET /api/v1/plans`, `GET /api/v1/plans/:id`, `GET /api/v1/preferences` and the Strava/Garmin status and disconnect routes.
- The SPA fallback route in `server/static.ts` has its own rate limiter (100 requests per 15 minutes)

### Body Size Limits

The larger limits below are not applied at app level. The app-wide JSON parser skips these paths, and the protected route stack parses their bodies after the auth guard and the route's rate limiter (`largeJsonBodyParser`, `server/largeBodyParsers.ts`), so an anonymous client cannot make the instance buffer a multi-MB body.

- `/api/v1/coaching-materials`: 2 MB JSON (coaching documents can be large)
- `POST /api/v1/plans/import`: 1 MB JSON (up to 100,000 CSV characters, JSON-escaped)
- Coach chat sends, `POST /api/v1/chat` and `POST /api/v1/chat/stream`: 5 MB JSON, for a message's optional photo. Matched by `isChatSendPath()` in `server/imageParsePaths.ts`
- Image-parse routes: 10 MB JSON, for base64 image payloads. The paths are matched by `isImageParsePath()` in `server/imageParsePaths.ts`: the stateless `parse-exercises-from-image` and `parse-workout-structure-from-image` parsers, the workout and plan-day `reparse-from-image` routes, and `nutrition/parse/photo` and `nutrition/parse/label`
- All other routes: 100 KB JSON, parsed at app level
- URL-encoded bodies: 100 KB on every route

### Request ID Validation

Client-supplied `X-Request-ID` headers are validated against `^[A-Za-z0-9._-]{1,36}$` to prevent log injection. The colon was deliberately dropped — it is adjacent to log-parser delimiters — and 36 characters fits a UUID or ULID with no room for padding. Invalid or missing IDs are replaced with a `randomUUID()`.

### CSRF Protection

**File:** `server/middleware/csrf.ts`

CSRF protection uses the **double-submit cookie pattern** via the `csrf-csrf` library. This prevents cross-site request forgery on all state-changing endpoints.

**Flow:**

1. Client calls `GET /api/v1/csrf-token` (safe method, exempt from verification). The server sets a signed `__Host-fitai.x-csrf` cookie (production) or `fitai.x-csrf` cookie (development) and returns the paired token in JSON.
2. Client attaches the token as the `x-csrf-token` header on all mutating requests (POST/PUT/PATCH/DELETE).
3. The `csrfProtection` middleware verifies the header matches the cookie HMAC before forwarding the request.

**Session binding:** The CSRF token is bound to the Clerk `userId` when authenticated, so tokens issued pre-login are invalidated after sign-in and tokens cannot be replayed across users. Falls back to client IP for the pre-login window.

**Bearer-token exemption:** a mutating request that Clerk authenticated from an `Authorization: Bearer` header, and that carries no Clerk session cookie, skips the check — it holds no ambient credential to forge. One whose bearer token Clerk rejects gets `401 UNAUTHORIZED` instead of `EBADCSRFTOKEN`. Conditions and rationale: `bearerAuthState()` and [Authentication -- Bearer-Token Clients](authentication.md#bearer-token-clients-native-app).

**Configuration:**

- Cookie: `httpOnly: true`, `sameSite: "strict"`, `secure: true` (production)
- HMAC signing key: the `CSRF_SECRET` env var. **Required in production** and **must differ from `ENCRYPTION_KEY`** — both invariants are enforced at startup by `server/env.ts` Zod `.refine()` guards that abort boot with `❌ FATAL:` messages. When unset in dev/test, `resolveCsrfSecret()` generates a random per-process secret (it is **not** aliased to `ENCRYPTION_KEY`). See [Authentication → Key Separation](authentication.md#key-separation-csrf_secret-vs-encryption_key).
- Safe methods (GET/HEAD/OPTIONS) are exempt from verification

### Idempotency Middleware

**File:** `server/middleware/idempotency.ts`

Server-side enforcement for the `X-Idempotency-Key` header sent by the client's offline queue on replay.

**Behavior:**

- Applies to mutating methods only (POST/PUT/PATCH/DELETE)
- Requests without the header pass through untouched
- Before the handler runs, the `(userId, key)` pair is atomically claimed in the `idempotency_keys` table as an in-progress row with a 60-second TTL and a random claim token, so a crashed request frees the key quickly. A concurrent duplicate that finds a live claim gets `409` with code `IDEMPOTENT_REQUEST_IN_PROGRESS`
- Only a `2xx` response sent through `res.json` is cached (status code + body, 7-day TTL). Any other outcome, including a response that finishes without `res.json`, releases the claim so the same key can be retried
- Caching and releasing are fenced to the claim token: they act only on the claim this request still owns, never on a newer claim another request made after this one lapsed
- A client disconnect releases nothing, because the handler is still running and may yet commit. Its `res.json` still caches the result after the socket is gone, so a replay with the same key gets `409` while the handler runs and the stored response after it; a handler that never answers leaves the claim to lapse after 60 seconds
- Response bodies over 64 KB are cached as a `{ idempotencyReplayed: true }` sentinel instead of the full payload
- On repeat requests with the same key, the cached response (status code + body) is returned without re-executing the handler
- Key length is capped at 255 characters (returns 400 if exceeded)
- Must be mounted after `isAuthenticated` so `getUserId()` can resolve the caller
- Storage failures are logged and the request proceeds without idempotency guarantees (graceful degradation)

### Dev Auth Bypass Guard

`ALLOW_DEV_AUTH_BYPASS=true` stops the process from starting if `NODE_ENV` is `"production"`. Two guards enforce it: the Zod schema refinement in `server/env.ts` throws while the environment is parsed, and a runtime check in `server/index.ts` logs a fatal line and calls `process.exit(1)` if the value ever gets past the schema.

### Error Sanitization

The global error handler (`server/middleware/errorHandler.ts`) passes on a status and message from two sources only: an `AppError`, whose message is replaced by a generic `"Internal Server Error"` at 500, and the app's own HTTP layer — the client-safe 4xx errors body-parser and csrf-csrf build with http-errors (`expose: true`), such as a malformed-JSON 400, a 413 or `EBADCSRFTOKEN` — plus the router's own 400 for a malformed percent-escape in a route param (a `URIError`), answered with a fixed `Malformed URL` message and never reported to Sentry. Any other error that carries a status came from someone else's API (an AI provider's 400/401/403/429, a Strava 404) and is answered `502 EXTERNAL_API_ERROR` with a generic message, so a provider 429 is never read as the app's rate limit and a rotated key never looks like an expired session; an error with no status is a generic `500 INTERNAL_SERVER_ERROR`. Error details (`err.details`) are only included for responses below 500. A 413 is answered with the handler's own message and the code `PAYLOAD_TOO_LARGE` rather than body-parser's. Only 5xx errors and 429s are reported to Sentry (`shouldReportToSentry()`); every other status is still logged (`error` level at 500 and above, `warn` below) and returned but not sent upstream. When the response has already started (an SSE stream that failed mid-reply), the handler logs the error and passes it to Express's default handler, which closes the connection.

The same rule applies to errors that are **stored** and read back later, not just
those returned inline. `training_plans.generation_error` is surfaced verbatim by
`GET /api/v1/plans/:id/generation-status`, so plan generation records only an
`AppError` message (already written for users); any other thrown error — provider,
database driver, HTTP layer, all of which can name internal hosts, models or query
fragments — is stored as a generic message while the full error goes to the logs
and Sentry.

### SSRF Guard

**File:** `server/ssrfGuard.ts`

Two layers protect outbound requests to any URL the app did not hard-code:

1. `checkSafeOutboundUrl(url)` — synchronous, rejects literal loopback, private,
   link-local, carrier-grade-NAT (`100.64.0.0/10`, which carries Alibaba's
   instance metadata at `100.100.100.200`), multicast and reserved addresses;
   `localhost` in all its spellings, including a trailing dot and any
   `*.localhost` subdomain, since RFC 6761 reserves that whole tree; the
   unspecified addresses `0.0.0.0` and `::`; IPv4-mapped IPv6; and NAT64
   (`64:ff9b::/96`) embedding a private IPv4. Documentation ranges such as
   TEST-NET are deliberately **allowed** — they are unroutable rather than
   internal, so blocking them buys nothing.
2. `assertResolvedHostIsPublic(url)` — resolves a non-literal hostname's A/AAAA
   records and refuses if any resolved address is private. Run at startup for
   `AI_TEXT_BASE_URL`; DNS errors are non-fatal so a resolver hiccup does not
   block an otherwise-healthy boot.

Callers: `AI_TEXT_BASE_URL` at env-parse time and again at startup, and every
web-push endpoint at both subscribe and send time. Both AI provider adapters also
set `redirect: "error"` on their `fetch` calls, because following a redirect
would re-POST the request body to a host that never passed the guard.

### Error Handling Flow

```mermaid
sequenceDiagram
    participant Client
    participant Express
    participant Handler as Route Handler
    participant Sentry
    
    Client->>Express: API Request
    Express->>Handler: After middleware
    Handler-->>Express: throw AppError, or next(err)
    Note over Express: status = the AppError's, the HTTP layer's 4xx,<br/>502 for another service's status, else 500
    alt status >= 500 or status == 429
        Express->>Sentry: captureException(err)
    end
    alt an AppError, or the HTTP layer's 4xx
        Express->>Client: { error: err.message, code, details } (message hidden at 500, details below 500 only)
    else another service's status
        Express->>Client: 502 { error: generic message, code: "EXTERNAL_API_ERROR" }
    else no status
        Express->>Client: 500 { error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" }
    end
```

---

## Logging

Structured logging is provided by **Pino** (`server/logger.ts`).

### Configuration

- Log level is set via `LOG_LEVEL` environment variable (default: `"info"`)
- Sensitive headers are redacted: `authorization`, `cookie`, `x-csrf-token`, `x-idempotency-key`, `x-cron-secret`, `x-internal-analytics-secret` (the `SENSITIVE_REQUEST_HEADERS` list, which the Sentry `beforeSend` scrubber in `server/bootstrap/observability.ts` also uses). Credential-like request-body fields (e.g. passwords, access/refresh tokens, API keys, client secrets, `imageBase64`, Web Push `p256dh`/`auth` keys) are redacted too, as are the response `set-cookie` header (it carries the CSRF cookie) and the AI provider key fields (`openAiCompatibleApiKey`, `anthropicApiKey`) of a logged config object. The full list is `LOG_REDACT_PATHS`
- Outside production (`NODE_ENV` other than `production`), `pino-pretty` is used for human-readable colorized output
- In production, raw JSON is emitted (suitable for log aggregation)
- A `mixin()` adds the async-local `requestId` to every line logged inside a request or a pg-boss job, including lines written through the module-level `logger`. `userId` is deliberately left out

### pino-http Middleware

The `pino-http` middleware adds structured context to every request log:

- **requestId** -- from validated `X-Request-ID` header or generated UUID
- **userId** -- always `"anonymous"` on the per-request `req.log` child, which is bound at request start, before `clerkMiddleware()` has run. The completion line re-reads Clerk auth: a signed-in request logs `"authenticated"` when it succeeds and its real Clerk user id only when the response status is >= 400, keeping user ids out of the high-volume success log
- **route** -- the request URL path (query string stripped)
- **context** -- set to `"http"`
- **appPlatform** / **appVersion** -- only on requests from the native app, taken from the validated `X-App-Platform` and `X-App-Version` headers (`readAppClient()`); a malformed version logs as `"invalid"`

The request serializer logs the URL path only: the query string and the parsed `query` object are dropped, because OAuth callbacks carry the provider `code` and signed `state` there.

Auto-logging is filtered to API routes only (`req.url` starting with `/api/v1`). Non-API requests (static assets, SPA fallback) are not logged by pino-http.

---

## Graceful Shutdown

`server/index.ts` wires `registerShutdownHandlers()` (`server/bootstrap/lifecycle.ts`) for `SIGTERM` and `SIGINT`. The shutdown sequence:

1. **Force-exit timer** -- A 60-second timeout (`SHUTDOWN_TIMEOUT_MS`) is set. If graceful shutdown does not complete within this window, `process.exit(1)` is called. The timer is `unref()`-ed so it does not keep the event loop alive. On a deploy, Railway gives the outgoing deployment `drainingSeconds: 65` (`.railway/railway.ts`) between `SIGTERM` and `SIGKILL`, so this budget runs to the end; Railway's default is 0 seconds.

2. **Stop cron** -- `stopCron()` halts the `node-cron` scheduler.

3. **Drain SSE streams** -- `drainSseStreams()` closes in-flight Server-Sent Events connections (e.g. coach chat) with a 5-second grace window.

4. **Close HTTP server** -- `httpServer.close()` stops accepting new connections and waits for existing connections to drain.

5. **Stop queue** -- `queue.stop()` shuts down the pg-boss job queue.

6. **Drain database pools** -- `pool.end()` (main DB) and `vectorPool.end()` (vector DB) are called in parallel.

7. **Flush Sentry** -- `Sentry.close()` flushes buffered events with a 10-second timeout.

8. **Exit** -- `process.exit(0)` on success, `process.exit(1)` on error.

A second signal while shutdown is under way is ignored. Once `drainSseStreams()` has run, a stream that registers late (its request was mid-handler when the signal arrived) is aborted immediately by `registerSseStream()`.

`registerProcessErrorHandlers()` (`server/bootstrap/observability.ts`) handles `uncaughtException` and `unhandledRejection` separately from this sequence: it logs the error at `fatal`, sets `startupError` if none is set yet (so both health endpoints answer `503`), reports to Sentry, waits up to 2 seconds for the flush and calls `process.exit(1)`.

### Health Check Lifecycle

- `isReady` starts as `false`, `startupError` as `null`
- Server listens on port BEFORE routes register (allows health check during startup)
- `GET /api/v1/health` (readiness) returns `503` `{ status: "starting", phase, ... }` while bootstrapping
- Once the `ready` phase sets `isReady = true` (after `registerRoutes()` and the post-route wiring), it probes the main DB and, when `VECTOR_DATABASE_URL` is set, the vector DB (each probe is a `SELECT 1` with a 3 s timeout; results are cached for 5 s). It returns `{ status: "ok", vectorSchema, ... }` when both answer, otherwise `503` `{ status: "degraded", db, vectorDb, vectorSchema, ... }`
- If startup throws, `startupError` is set -- returns `503` `{ status: "error", error: "startup_error", phase, ... }`. The raw error message is only logged, never returned
- `GET /api/v1/health/live` (liveness) never touches the DB: it returns `{ status: "alive", uptimeMs, ... }`, or `503` `{ status: "startup_failed", phase, ... }` once startup has failed. It answers 200 before boot has finished, so it is not a deploy gate
- `.railway/railway.ts` points Railway's healthcheck at `/api/v1/health` (readiness). Railway polls it only while a deploy rolls out: the first 2xx makes the new deployment active and retires the old one, and it is not polled after go-live. A release whose boot fails therefore fails its deploy, and the previous deployment keeps serving (D2, [CODEBASE_ANALYSIS_2026-10-03](CODEBASE_ANALYSIS_2026-10-03.md))
- CI polls `/api/v1/health` via `script/wait-for-health.js` to know when the server is ready

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
| `ENCRYPTION_KEY` | Yes (until retired) | Minimum 32 characters, used for encrypting sensitive data. May be removed once `ENCRYPTION_KEY_V2` is set and every stored credential has moved to it; boot refuses to finish while any still needs it. |
| `NODE_ENV` | No | `"development"` (default), `"production"`, or `"test"` |
| `PORT` | No | Server listen port (default: `"5000"`) |
| `CLERK_PUBLISHABLE_KEY` | No | Clerk frontend key |
| `CLERK_SECRET_KEY` | No | Clerk backend key. Without both Clerk keys, `setupAuth()` throws at startup unless the dev auth bypass is enabled |
| `SENTRY_DSN` | No | Sentry error tracking DSN |
| `RESEND_API_KEY` | No | Resend email delivery API key (email disabled if unset) |
| `RESEND_FROM_EMAIL` | No | Sender address for outbound emails |
| `VAPID_PUBLIC_KEY` | No | Web Push VAPID public key. Web Push is enabled only when `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_EMAIL` are all set; otherwise `GET /api/v1/push/vapid-key` returns 404 (`PUSH_NOT_CONFIGURED`) and browser subscriptions are skipped on send |
| `VAPID_PRIVATE_KEY` | No | Web Push VAPID private key |
| `VAPID_EMAIL` | No | Bare contact email address for Web Push; the server prepends `mailto:` when registering VAPID details |
| `FCM_SERVICE_ACCOUNT_JSON` | No | Firebase service account key file (JSON, pasted whole) for native app push through FCM (`server/fcm.ts`). Unset disables native push; Web Push is unaffected |
| `AI_FEATURES_ENABLED` | No | Runtime kill switch for AI provider traffic (default `true`; `false` disables all AI features) |
| `AI_GLOBAL_DAILY_LIMIT_CENTS` | No | Application-wide rolling-24h AI spend ceiling in cents. Unset means no global ceiling (per-user cap only) and a startup warning in production |
| `AI_TEXT_PROVIDER` | No | Text AI provider (`gemini`, `anthropic`, or `openai-compatible`; default `gemini`) |
| `AI_TEXT_MODEL` | No | Default text model override for the configured provider |
| `AI_TEXT_FAST_MODEL` | No | Fast text model override for parsing-style calls |
| `AI_TEXT_REASONING_MODEL` | No | Reasoning text model override for coaching and plan generation |
| `AI_TEXT_REASONING_EFFORT` | No | Reasoning effort hint (`none`, `low`, `medium`, `high`; default `high`) |
| `AI_CHAT_REASONING_EFFORT` | No | Reasoning effort for coach chat replies only (default: lower of `AI_TEXT_REASONING_EFFORT` and `medium`) |
| `AI_CHAT_TOOLS` | No | Function calling for the streaming coach chat: read tools and the plan-change tool (`true`/`false`; default `false`) |
| `AI_TEXT_API_KEY` | No | Generic API key for non-Gemini text providers |
| `AI_TEXT_OPENAI_COMPATIBLE_PROFILE` | No | OpenAI-compatible profile (`openai`, `xai`, `groq`, `together`, `openrouter`, `deepseek`, or `custom`) |
| `AI_TEXT_BASE_URL` | No | Base URL for OpenAI-compatible providers |
| `GEMINI_API_KEY` | No | Gemini key for the Gemini text provider, RAG embeddings, and image parsing |
| `CRON_SECRET` | No | Secret for authenticating external cron triggers |
| `INTERNAL_ANALYTICS_SECRET` | No | Secret for authenticating internal analytics health endpoints |
| `STRAVA_CLIENT_ID` | No | Strava OAuth client ID |
| `STRAVA_CLIENT_SECRET` | No | Strava OAuth client secret |
| `STRAVA_STATE_SECRET` | Yes (production, when Strava is configured) | 32+ char secret for signing Strava OAuth state tokens. Unset, each replica signs with its own per-process random secret, so a callback landing on a different instance than the one that issued the state fails verification |
| `STRAVA_AUTO_SYNC_ENABLED` | No | Master switch for automatic Strava sync (default `true`) |
| `STRAVA_AUTO_SYNC_INTERVAL_MINUTES` | No | Polling-fallback staleness threshold (default `60`) |
| `STRAVA_WEBHOOKS_ENABLED` | No | Register and act on the Strava push subscription (default `true`) |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | No | Webhook validation token; derived from the client secret when unset |
| `APP_URL` | No | Public application URL (used for CORS, OAuth callbacks) |
| `ALLOWED_ORIGINS` | No | Comma-separated list of additional CORS origins |
| `MIN_APP_VERSION_ANDROID` / `MIN_APP_VERSION_IOS` | No | Oldest native app build served, as `MAJOR.MINOR.PATCH`; older builds get `426 APP_UPDATE_REQUIRED` (`appVersionGate`). Unset serves every build |
| `ANDROID_APP_PACKAGE` / `ANDROID_APP_CERT_SHA256` | No | Android package name and signing-certificate fingerprints for `/.well-known/assetlinks.json`. Must be set together; both unset makes the route a 404 |
| `TRUST_PROXY` | No | Express `trust proxy` setting for client IP derivation (default `1`) |
| `VECTOR_DATABASE_URL` | No | Separate Neon PostgreSQL URL for vector storage; falls back to `DATABASE_URL` |
| `ALLOW_DEV_AUTH_BYPASS` | No | Set to `"true"` to bypass auth in development (fatal in production) |
| `LOG_LEVEL` | No | Pino log level (default: `"info"`) |
| `RAG_CHUNK_SIZE` | No | Character count per RAG chunk (default: `600`; a positive whole number) |
| `RAG_CHUNK_OVERLAP` | No | Overlap characters between RAG chunks (default: `100`; `0` up to `RAG_CHUNK_SIZE` minus one) |
| `ENCRYPTION_KEY_V2` | No | Rotation key for `ENCRYPTION_KEY`. When set, new ciphertext is tagged `v2`; the v1 key stays available to decrypt existing rows. Must differ from `ENCRYPTION_KEY` and `CSRF_SECRET`. |
| `ENCRYPTION_REENCRYPT_ON_BOOT` | No | `"true"` (with `ENCRYPTION_KEY_V2` set) re-encrypts stored Strava/Garmin credentials to the active key version on boot. Default `"false"`. |
| `CSRF_SECRET` | Yes (production) | Minimum 32 characters, used for CSRF token HMAC. It is **required** in production, and whenever it is set it **must differ** from `ENCRYPTION_KEY` (in every environment). Auto-generated per process in dev/test if unset. |

This table covers the variables most relevant to the server runtime. It is not exhaustive -- see [Environment Variables](env-reference.md) for the complete reference, including AI model overrides and feature flags.

---

## Key Configuration

### Database Pools

**Main pool** (`server/db.ts`):
- Connection string: `DATABASE_URL`
- Max connections: 20
- Idle timeout: 30 s (`DB_IDLE_TIMEOUT_MS`)
- Connection timeout: 10 s (`DB_CONNECTION_TIMEOUT_MS`)
- Statement timeout: 30 s (`DB_STATEMENT_TIMEOUT_MS`)
- **SSL selection:** Enabled in production (`rejectUnauthorized: true`) **unless** the `DATABASE_URL` hostname ends in `.railway.internal`. Railway's internal Postgres network stays on private IPv6 and does not speak SSL, so forcing TLS on an internal-host URL breaks connections. The hostname is parsed via `new URL(env.DATABASE_URL)` with a try/catch fallback.
- Drizzle ORM wraps the pool with the shared schema

**Vector pool** (`server/vectorDb.ts`):
- Connection string: `VECTOR_DATABASE_URL` (falls back to `DATABASE_URL`)
- Max connections: 5
- Idle timeout: 30 s
- Connection timeout: 10 s (`VECTOR_DB_CONNECTION_TIMEOUT_MS`)
- Statement timeout: 30 s
- SSL selection: the same rule as the main pool, applied to whichever URL the pool uses
- Used for `pgvector` similarity search on document chunks

Both pools log unexpected errors on idle clients.

### Job Queue

pg-boss (`server/queue.ts`) is initialized with the `DATABASE_URL` connection string, to which `buildQueueConnectionString()` adds a 45-minute session `statement_timeout` (`PGBOSS_STATEMENT_TIMEOUT_MS`): pg-boss owns its own pool, so the main pool's 30 s limit does not reach job handlers. Workers are registered for every queue at boot — ten in `server/queue.ts`, plus `strava-sync` in `server/services/stravaAutoSync.ts` and `session-streams` in `server/services/sessionStreamSync.ts`.

**The queue catalogue lives in [Integrations → Job Types](integrations.md#job-types)** — name, worker and payload for each. It is not repeated here: this section previously carried a second copy of that table and drifted from it.

Idempotent jobs use `DEFAULT_JOB_OPTIONS` (retry 3× with exponential backoff); the email send jobs and `plan-generation` use `NO_RETRY_JOB_OPTIONS`. Each email job claims its send in the database before calling Resend, so a send that fails after the claim is forgone for that window rather than retried. Each job runs under a 50-minute wall-clock timeout (`JOB_TIMEOUT_MS`), inside the 60 minutes after which pg-boss expires an active job (`expireInSeconds`), and in-batch parallelism is bounded to 2. Failed jobs are re-thrown to let pg-boss handle retries.

### Cron Scheduling

`server/cron.ts` uses `node-cron` for in-process scheduled tasks. Each cron body is wrapped in a PostgreSQL advisory lock (`runCronJobWithLock()`, keyed via `CRON_LOCK_KEYS`) so duplicate schedulers skip work instead of running the same maintenance job twice.

**The schedule catalogue lives in [Integrations → Registered Cron Jobs](integrations.md#registered-cron-jobs)** — expression, timezone and advisory lock for each job. As with the queue table above, the copy that used to sit here drifted from it.

Cron jobs run in-process on **each** app replica; the advisory lock above is what keeps only one of them doing the work. Rate limits use `rate_limit_buckets`, while the Clerk seen-cache, the AI circuit-breaker state and the embedding health probe use `server_runtime_cache`, so running more than one replica does not weaken abuse prevention or provider-spend cache behavior.

### Shared Runtime State

Two Postgres tables hold the state that replicas share. `server/sharedRuntimeState.ts` owns the `server_runtime_cache` helpers (`getRuntimeCache`, `setRuntimeCache`, `claimRuntimeCacheKey`, `deleteRuntimeCache`, `deleteRuntimeCachePrefix`) and the expiry sweep for both tables:

- `rate_limit_buckets` stores per-limiter (category, cap and window) request counters and reset timestamps for `rateLimiter(...)`. It is read and written by `PostgresRateLimitStore` in `server/rateLimitStore.ts`.
- `server_runtime_cache` stores short-lived, TTL-bound entries for the Clerk auth seen-cache and the ten-minute tombstone that stops an erased account from being re-provisioned, single-use Strava OAuth state claims, the Strava background-sync 429 cooldown, the Strava webhook subscription state, the Garmin 429 breaker and per-user in-flight lock, the AI circuit-breaker state, planned-session estimates, the embedding health probe, and the record of which USDA food-detail reads came back without portions or micronutrients (`server/services/nutrition/foodDetail.ts`). The RAG retrieval cache is process-local, keyed on each athlete's retrieval version so a replica never serves a stale entry. The Gemini embedding-vector cache is deliberately process-local (`server/gemini/client.ts`) and is not stored here.
- Expired rows are pruned daily by the `sharedRuntimeCleanup` cron job at 04:15 UTC.

### Route Utilities

`server/routeUtils.ts` provides shared utilities used across route modules:

- `rateLimiter(category, max, windowMs)` -- per-route rate limiting factory
- `validateBody(schema)` / `validateQuery(schema)` / `validateParams(schema)` -- Zod-based validation middleware for the request body, query string, and route params. On success the parsed (coerced) value is written back with `Object.defineProperty`, because Express 5 exposes `req.query` as a read-only getter that a plain `req.query = ...` assignment throws on.
- `asyncHandler(fn)` -- wraps async route handlers with error forwarding to `next(err)`
- `formatValidationErrors(error)` / `sendValidationError(res, error)` -- format Zod errors into safe client-facing `{ path, message }` issues and send the `400 VALIDATION_ERROR` response the validators use
- `sendNotFound(res, message)` -- the uniform `404 { error, code: "NOT_FOUND" }` response
- `parsePagination(query, res, options)` -- parses `?limit` / `?offset`, answering `400` for an invalid value and `412 PRECONDITION_FAILED` for a limit above `maxLimit`
- `calculateStreak(completedDates, userTimezone)` -- calculates consecutive workout day streaks, anchored to the athlete's local today (default `UTC`)

> **Express 5 note:** under `@types/express` v5 the default `req.params` value type widened to `string | string[]`, so handlers that read a path parameter type their request generic -- e.g. `Request<{ id: string }>` -- to keep `req.params.id` a `string` (see `server/routes/coaching.ts` and `server/routes/plans.ts`).

### Static File Serving

In production and under `NODE_ENV=test` (`server/static.ts`):

- `/assets/*` is served with `maxAge: "1y"` and `immutable: true`, i.e. `Cache-Control: public, max-age=31536000, immutable` (fingerprinted build artifacts)
- Other static files are served with `max-age=0` and no index
- A missing `/assets/*` file is a `404` (with `Cache-Control: no-store`), and an `/api` path no route matched is a JSON `404 NOT_FOUND`. Neither gets the SPA shell: a missing chunk must fail as a chunk error, and the offline queue treats any `2xx` as synced
- The SPA fallback (`/{*splat}`) reads `index.html` once at startup and injects the per-request CSP nonce into all `<script>` tags, and answers with `Cache-Control: no-cache`. The named-wildcard form is required by Express 5's path-to-regexp v8 -- a bare `*` throws at route registration
- The fallback route is rate-limited to 100 requests per 15-minute window

When `NODE_ENV` is `development`, `server/vite.ts` serves the client through Vite's middleware and answers an unmatched `/api` path with the same JSON `404 NOT_FOUND` before its own `index.html` fallback, so dev behaves like production for a renamed route (C38, [CODEBASE_ANALYSIS_2026-10-03](CODEBASE_ANALYSIS_2026-10-03.md)).

---

See also: [Authentication](authentication.md), [Database -- Storage Layer](database.md#storage-layer), [Architecture -- Request Lifecycle](architecture.md#2-request-lifecycle)
