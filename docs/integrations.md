# External Integrations

This document covers the external service integrations used by the Hyrox Companion application: Strava and Garmin activity syncing, Resend transactional email, pg-boss job queue, node-cron scheduling, and Sentry error tracking.

---

## Table of Contents

1. [Overview](#overview)
2. [Strava Integration](#strava-integration)
3. [Garmin Connect Integration](#garmin-connect-integration)
4. [Email System (Resend)](#email-system-resend)
5. [Job Queue (pg-boss)](#job-queue-pg-boss)
6. [Cron Scheduling (node-cron)](#cron-scheduling-node-cron)
7. [Error Tracking (Sentry)](#error-tracking-sentry)
8. [Startup Maintenance](#startup-maintenance)

---

## Overview

The application relies on six external integration layers:

- **Strava** -- OAuth 2.0 integration for importing workout activities from athletes' Strava accounts.
- **Garmin Connect** -- Email/password sign-in against Garmin's reverse-engineered SSO (no public OAuth) to import activities. Wrapped in a strict safety stack because every request goes out through the same shared server IP.
- **Resend** -- Transactional email delivery for weekly training summaries and missed workout reminders.
- **pg-boss** -- PostgreSQL-backed persistent job queue for background processing (auto-coaching, embedding generation). Retries are scoped to idempotent handlers only.
- **node-cron** -- In-process cron scheduler that triggers the daily email pipeline.
- **Sentry** -- Server- and client-side error tracking. Completely optional; a missing DSN disables reporting without affecting the rest of the app.

All integrations are configured through environment variables and initialized during server startup.

---

## Strava Integration

**Key files:**

- `server/strava.ts` -- OAuth routes, token management, activity sync endpoint
- `server/services/stravaMapper.ts` -- Maps Strava activity JSON to the internal `WorkoutLog` shape
- `server/crypto.ts` -- AES-256-GCM encryption/decryption for tokens at rest
- `shared/schema/tables.ts` -- `stravaConnections` table definition

### Strava OAuth Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant Client as React App
    participant Server as Express API
    participant Strava as Strava API
    participant DB as PostgreSQL
    
    User->>Client: Click "Connect Strava"
    Client->>Server: GET /api/v1/strava/auth
    Server->>Server: createSignedState(userId) with HMAC-SHA256
    Server->>Client: { url: "strava.com/oauth/authorize?state=..." }
    Client->>Strava: Redirect to authorization URL
    User->>Strava: Approve access
    Strava->>Server: GET /api/v1/strava/callback?code=...&state=...
    Server->>Server: verifySignedState(state) — CSRF check + max age
    Server->>Strava: POST /oauth/token (exchange code for tokens)
    Strava->>Server: { access_token, refresh_token, expires_at }
    Server->>Server: encryptToken(access_token), encryptToken(refresh_token)
    Server->>DB: INSERT strava_connections (encrypted tokens)
    Server->>Client: Redirect to /settings
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STRAVA_CLIENT_ID` | Yes | Strava API application client ID |
| `STRAVA_CLIENT_SECRET` | Yes | Strava API application client secret |
| `STRAVA_STATE_SECRET` | Recommended | HMAC secret for signing OAuth state tokens. If not set, a random secret is generated at boot (not safe across multiple server instances). |
| `APP_URL` | Recommended | Base URL of the application (e.g. `https://fitai.coach`). Used to construct the OAuth redirect URI. Defaults to `http://localhost:5000`. |
| `ENCRYPTION_KEY` | Yes | 32-byte hex string used for AES-256-GCM encryption of stored tokens. If not valid hex or wrong length, a SHA-256 hash of the value is derived. |

### OAuth 2.0 Flow

1. **Authorization URL generation** (`GET /api/v1/strava/auth`): The authenticated user requests an authorization URL. The server creates a signed state token containing the user ID, a timestamp (base-36 encoded), and a random nonce. The state is HMAC-SHA256 signed with `STRAVA_STATE_SECRET`. The Strava authorization URL is returned with scope `activity:read_all`.

2. **Callback handling** (`GET /api/v1/strava/callback`): Strava redirects the user back with a `code` and `state` parameter. The server verifies the signed state using timing-safe comparison (via double-hashing with `crypto.timingSafeEqual`) and checks that the state is not older than 10 minutes (`STRAVA_STATE_MAX_AGE_MS`).

3. **Token exchange**: The authorization code is exchanged for an access token, refresh token, and athlete information via a POST to `https://www.strava.com/oauth/token` with `grant_type: authorization_code`.

4. **Connection storage**: The token set and athlete ID are persisted to the `strava_connections` table via `storage.upsertStravaConnection()`.

### CSRF State Verification

The OAuth state parameter serves as a CSRF token. It is structured as `userId:timestamp:nonce:signature` where:

- `timestamp` is base-36 encoded `Date.now()`
- `nonce` is 8 random bytes (hex)
- `signature` is a full 256-bit HMAC-SHA256 over the payload

Verification uses timing-safe comparison by hashing both the received and expected signatures with SHA-256, then comparing with `crypto.timingSafeEqual`. This prevents timing attacks and safely handles inputs of different lengths.

### Encrypted Token Storage

Tokens are encrypted at rest using AES-256-GCM (`server/crypto.ts`):

- **Algorithm**: `aes-256-gcm`
- **IV**: 12 random bytes per encryption (recommended size for GCM)
- **Storage format**: `iv:authTag:ciphertext` (all hex-encoded)
- **Graceful migration**: If stored data does not match the `iv:authTag:ciphertext` format (e.g., legacy plaintext), the decryptor returns the raw value, allowing gradual migration.

The encryption key is lazy-loaded so the server can boot in CI environments without performing crypto operations immediately.

### Token Refresh

When `getValidAccessToken()` is called and the current token's `expiresAt` has passed, the server automatically refreshes the token:

1. POST to `https://www.strava.com/oauth/token` with `grant_type: refresh_token`
2. The new token set (access token, refresh token, expiration) is persisted back to the database
3. The fresh access token is returned for use

All external Strava API calls use `AbortSignal.timeout(15000)` (the `EXTERNAL_API_TIMEOUT_MS` constant).

### Token Refresh Flow

```typescript
// From server/strava.ts — getValidAccessToken()
async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await storage.getStravaConnection(userId);
  if (!connection) return null;

  // Token still valid — return decrypted token
  if (connection.expiresAt > new Date()) {
    return connection.accessToken; // auto-decrypted by storage layer
  }

  // Token expired — refresh via Strava API
  const refreshed = await refreshStravaToken(connection.refreshToken);
  if (!refreshed) return null;

  // Store new encrypted tokens
  await storage.upsertStravaConnection({
    userId,
    stravaAthleteId: connection.stravaAthleteId,
    accessToken: refreshed.access_token,   // encrypted on write
    refreshToken: refreshed.refresh_token,  // encrypted on write
    expiresAt: new Date(refreshed.expires_at * 1000),
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt,
  });

  return refreshed.access_token;
}
```

### Activity Sync

Triggered by `POST /api/v1/strava/sync` (rate-limited to 5 requests per 15 minutes):

1. Fetches the 30 most recent activities from `GET https://www.strava.com/api/v3/athlete/activities?per_page=30`
2. Checks which activity IDs already exist in the database via `storage.getExistingStravaActivityIds()` to avoid duplicates
3. New activities are mapped through `mapStravaActivityToWorkout()` which extracts:
   - Date (from `start_date_local`)
   - Focus (from `sport_type` or `type`)
   - Main workout description (distance + duration, or duration-only for non-distance activities)
   - Accessory data (elevation gain, pace)
   - Notes (activity name, heart rate data)
   - Metrics: calories, distance (meters), elevation gain, avg/max heart rate, avg/max speed, cadence, watts, suffer score
4. Distance and pace are formatted according to the user's preferred `distanceUnit` (km or miles)
5. All new workouts are batch-inserted via `storage.createWorkoutLogs()`
6. The `lastSyncedAt` timestamp on the Strava connection is updated

The response includes counts of imported, skipped, and total activities.

### Disconnect Flow

`DELETE /api/v1/strava/disconnect` removes the Strava connection record from the database via `storage.deleteStravaConnection()`. Previously imported workout logs are not deleted.

### Rate Limiting

- Auth and callback endpoints: 20 requests per 15 minutes per IP
- Sync endpoint: 5 requests per 15 minutes per IP

### Registered Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/strava/status` | Required | Check if user has an active Strava connection |
| GET | `/api/v1/strava/auth` | Required | Generate Strava OAuth authorization URL |
| GET | `/api/v1/strava/callback` | None (state-verified) | OAuth callback from Strava |
| DELETE | `/api/v1/strava/disconnect` | Required | Remove Strava connection |
| POST | `/api/v1/strava/sync` | Required | Import recent activities from Strava |

### Database Schema

The `strava_connections` table (`shared/schema/tables.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | varchar(255) | Primary key, auto-generated UUID |
| `user_id` | varchar(255) | Unique, foreign key to `users.id` (cascade delete) |
| `strava_athlete_id` | varchar(255) | Strava's numeric athlete ID (stored as string) |
| `access_token` | text | Encrypted with AES-256-GCM |
| `refresh_token` | text | Encrypted with AES-256-GCM |
| `expires_at` | timestamp | Token expiration time |
| `scope` | text | OAuth scope granted |
| `last_synced_at` | timestamp | Nullable; updated after each successful sync |
| `created_at` | timestamp | Auto-set on creation |

---

## Garmin Connect Integration

**Key files:**

- `server/garmin.ts` -- Route handlers, safety layers, circuit breaker, per-user mutex
- `server/services/garminMapper.ts` -- Maps a Garmin activity payload to the internal `WorkoutLog` shape
- `server/crypto.ts` -- AES-256-GCM encryption/decryption (shared with Strava; see [Encryption at Rest](#encryption-at-rest))
- `shared/schema/tables.ts` -- `garminConnections` table definition

### Why This Is Different From Strava

Garmin does not offer a public OAuth application flow for end users. The only way the application can fetch a user's activities is to log into Garmin Connect on their behalf using their email and password, via the reverse-engineered SSO flow implemented by the [`@flow-js/garmin-connect`](https://www.npmjs.com/package/@flow-js/garmin-connect) library. This has three important consequences:

1. **Credentials are stored at rest** (encrypted with AES-256-GCM) so the server can re-login after the cached OAuth2 token expires (~1 year).
2. **Every outbound call shares the same server IP.** A single misbehaving user or buggy code path could earn the application's IP a Garmin-side ban that affects *every* user. The safety stack below is intentionally strict to prevent that.
3. **2-step verification is not supported.** The SSO library cannot pass Garmin's 2FA challenge; users with 2SV enabled must temporarily disable it to connect.

No server-side Garmin client/secret is needed -- there is nothing to configure in `.env` for this integration.

### HTTP Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/garmin/status` | Returns `{ connected, garminDisplayName?, lastSyncedAt?, lastError? }` for the authenticated user. |
| POST | `/api/v1/garmin/connect` | Body `{ email, password }`. Attempts a fresh login *before* persisting credentials; stores the row only on success. Rate-limited to 5 per 15-minute window per user. |
| DELETE | `/api/v1/garmin/disconnect` | Removes the user's `garmin_connections` row (tokens, credentials, display name). |
| POST | `/api/v1/garmin/sync` | Imports the 20 most recent activities via `getActivities()`, dedupes against `(user_id, garmin_activity_id)`, and returns `{ success, imported, skipped, total }`. Rate-limited to 5 per 15-minute window per user. |

All mutating routes go through `protectedMutationGuards` (authentication + CSRF + idempotency).

### Safety Stack

The order matters: each layer is designed to short-circuit requests before they cost the application a Garmin round-trip.

| Layer | Mechanism | File location |
|---|---|---|
| 1. Per-route rate limiter | 5 requests per 15 minutes per authenticated user on `/connect` and `/sync` | `garminConnectLimiter`, `garminSyncLimiter` in `server/garmin.ts` |
| 2. Per-user in-flight mutex | Rejects overlapping `/connect` or `/sync` calls for the same user with HTTP 409 `GARMIN_BUSY`. Catches the gap between the rate limiter and completion. | `withUserLock()` + `inFlightUsers: Set<string>` |
| 3. Minimum sync interval | Rejects `/sync` with HTTP 429 `GARMIN_SYNC_TOO_SOON` if `lastSyncedAt` is under 5 minutes old. | `MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000` |
| 4. Fail-fast on `lastError` | If a previous sync left `lastError` set, refuse to retry automatically. The user must disconnect + reconnect, which caps the cost of a broken connection to one failed login attempt. | `handleGarminSync` preflight + `getGarminClient` |
| 5. Global 429 circuit breaker | On *any* Garmin response that looks like a 429 ("429", "too many", "rate limit"), trip the breaker for 30 minutes. While tripped, every Garmin route returns HTTP 503 `GARMIN_CIRCUIT_OPEN` -- across all users on the instance. | `garminCircuitBreaker`, `GLOBAL_429_COOLDOWN_MS` |
| 6. No silent re-login | Cached OAuth tokens live ~1 year. If a fresh-looking token unexpectedly 401s, the error surfaces to the user instead of auto-triggering a new login. | `getGarminClient()` does not fall through from the cached-token path back to login |
| 7. Audit logging | Every Garmin API call and login is logged at `info` level with the user ID and a `context: "garmin"` tag so bans are traceable. | `logger.info({ userId, context: LOG_CTX }, ...)` throughout `server/garmin.ts` |

### Error Translation

`translateGarminError()` converts the library's stringly-typed errors into user-facing messages. Notable mappings:

- "429" / "too many" / "rate limit" → circuit breaker tripped, surface the 30-minute cooldown message.
- "401" / "unauthor" → invalid credentials, suggest disconnect + reconnect.
- "ticket" / "csrf" / "mfa" / "2fa" / "verification" → 2SV is enabled on the Garmin account; library cannot continue.

### Token Storage

The `garmin_connections` row stores four encrypted fields. All four are encrypted with `encryptToken()`/`decryptToken()` and share the same AES-256-GCM scheme used for Strava -- see [Encryption at Rest](#encryption-at-rest).

| Column | Purpose |
|---|---|
| `encrypted_email` | The user's Garmin login email, needed for forced re-login after token expiry. |
| `encrypted_password` | The user's Garmin password (same reason). |
| `encrypted_oauth1_token` | `JSON.stringify(IOauth1Token)` returned by `client.exportToken()` after login. |
| `encrypted_oauth2_token` | `JSON.stringify(IOauth2Token)` returned by `client.exportToken()` after login. |
| `token_expires_at` | UNIX-seconds-to-Date of `oauth2.expires_at`. When `now + 5 min >= token_expires_at`, the next request performs a fresh login. |
| `last_error` | Plaintext (non-secret) error message. Surfaced to the UI as a "reconnect needed" banner. Cleared on successful sync. |

A partial unique index on `workout_logs(user_id, garmin_activity_id) WHERE garmin_activity_id IS NOT NULL` guarantees dedupe at the DB layer even under concurrent imports. `createGarminWorkoutLogs()` uses `onConflictDoNothing`, and the route reports the true insert count (`imported`) plus anything swallowed by the partial index as `skipped`.

---

## Email System (Resend)

**Key files:**

- `server/email.ts` -- Resend client initialization and send functions
- `server/emailTemplates.ts` -- HTML template builders for each email type
- `server/emailScheduler.ts` -- Logic for deciding which emails to send to which users
- `server/routes/email.ts` -- HTTP endpoints for triggering email checks

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | API key for the Resend email service |
| `RESEND_FROM_EMAIL` | No | Sender address. Defaults to `fitai.coach <Timmy@fitai.coach>` |
| `CRON_SECRET` | Yes (for HTTP trigger) | Shared secret for authenticating the external cron HTTP endpoint |

### Email Types

#### 1. Weekly Training Summary

- **Trigger**: Sent on Mondays (day of week = 1), no more than once per 7 days per user
- **Guard**: Checks `user.lastWeeklySummaryAt` to prevent duplicates
- **Data gathered**: Completed/missed/skipped workout counts for the prior week, completion rate, current streak, total training duration
- **Subject line**: `Your Week in Review: X workout(s) completed`
- **Template**: Full HTML email with stat cards (completed count, completion rate, total time), a progress bar, streak display, and a CTA linking to the app timeline

#### 2. Missed Workout Reminder

- **Trigger**: Sent daily, no more than once per 24 hours per user
- **Guard**: Checks `user.lastMissedReminderAt` to prevent duplicates
- **Data gathered**: Plan days from yesterday that have "missed" status
- **Subject line**: `X missed workout(s) -- get back on track`
- **Template**: HTML email listing each missed workout with focus area, description (truncated to 120 chars), date, and plan name. Includes a CTA to the timeline.

### User Opt-In

Emails are only sent to users who meet all of these conditions:

1. `user.email` is set (non-null)
2. `user.emailNotifications` (the master toggle) is `true`
3. The per-type toggle for the specific email is `true`:
   - Weekly summary: `user.emailWeeklySummary` (default `true`)
   - Missed workout reminder: `user.emailMissedReminder` (default `true`)

The per-type toggles default to `true` so existing users maintain the
pre-migration behavior (receiving both categories) without an explicit
opt-in. Users can manage all three toggles from `/settings` — the
per-type switches are nested under the master toggle and are disabled
(grayed out) when the master is off. The email footer links back to
the settings page.

### Email Sending Pipeline

The `sendEmail()` function in `server/email.ts`:

1. Instantiates a `Resend` client with the API key
2. Calls `client.emails.send()` with from, to, subject, and HTML body
3. Returns `true` on success, `false` on error (errors are logged but not thrown)

### Batch Processing

`runEmailCronJob()` in `server/emailScheduler.ts`:

1. Calls `storage.markMissedPlanDays()` to mark past planned days as missed before checking
2. Fetches all users with `emailNotifications` enabled via `storage.getUsersWithEmailNotifications()`
3. Processes users in batches of 5 (concurrency limit) using `Promise.allSettled`
4. For each user, calls `checkAndSendEmailsForUser()` which independently checks and sends both email types
5. Returns a summary: users checked, emails sent, and detail strings

### HTTP Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/emails/check` | User auth | Trigger email check for the authenticated user (rate-limited to 5 per window) |
| GET | `/api/v1/cron/emails` | `x-cron-secret` header | External cron trigger for the full email pipeline. Secret is verified with timing-safe comparison. |

The external cron endpoint (`/api/v1/cron/emails`) allows platforms like Railway or external cron services to trigger the email job via HTTP, as an alternative to the internal node-cron scheduler.

### Encryption at Rest

All Strava tokens are encrypted at rest using AES-256-GCM (`server/crypto.ts`):

- **Algorithm**: AES-256-GCM with random 12-byte IV per encryption
- **Key**: 32-byte key from `ENCRYPTION_KEY` env var. Accepts hex-encoded or raw string (SHA-256 hashed to 32 bytes as fallback).
- **Format**: Stored as `${iv}:${authTag}:${encryptedText}` (all hex-encoded)
- **Legacy detection**: If stored value doesn't match the `iv:tag:data` format (3 colon-separated parts), it's treated as unencrypted legacy data -- enabling graceful migration.
- **Lazy key loading**: Key is loaded on first use, not at boot. This allows the server to start in CI environments without `ENCRYPTION_KEY`.
- **Failure mode**: Decryption failures throw (strict) -- never return corrupted data.

---

## Job Queue (pg-boss)

**Key file:** `server/queue.ts`

### Overview

The application uses [pg-boss](https://github.com/timgit/pg-boss), a PostgreSQL-backed job queue, for durable background processing. pg-boss stores jobs in dedicated PostgreSQL tables, providing persistence, retries, and distributed-safe job claiming.

### Initialization

```
const queue = new PgBoss(env.DATABASE_URL);
```

The queue is started via `startQueue()`, which:

1. Calls `queue.start()` to initialize pg-boss tables and begin polling
2. Creates named queues
3. Registers worker functions for each queue

Errors on the queue emit to a global error handler that logs via the application logger.

### Job Types

#### `auto-coach`

- **Purpose**: Triggers the AI auto-coaching pipeline for a user
- **Payload**: `{ userId: string }`
- **Worker**: Calls `triggerAutoCoach(userId)` from `server/services/coachService.ts`
- **On failure**: The error is re-thrown so pg-boss handles retries automatically

#### `embed-coaching-material`

- **Purpose**: Generates vector embeddings for user-uploaded coaching materials (used by the RAG pipeline)
- **Payload**: `{ materialId: string, userId: string }`
- **Worker**: Fetches the material from storage, then calls `embedCoachingMaterial()` from `server/services/ragService.ts`
- **On failure**: If the material is not found, the job is skipped with a warning. Other errors are re-thrown for pg-boss retry handling.
- **Batch behavior**: Jobs are processed via `Promise.allSettled`. If any jobs in the batch fail, a summary error is thrown.

### Job Processing Pattern

Both workers receive an array of `Job[]` objects and process them concurrently with a bounded `p-limit` pool (`IN_BATCH_CONCURRENCY = 2`) and `Promise.allSettled` semantics so a single poison job does not discard the whole batch. Failed jobs still aggregate into a thrown summary error so pg-boss sees the batch as failed and can retry only the failed ones on the next poll.

### Scoped Retries (Idempotent vs. Side-Effectful Jobs)

`server/queue.ts` exposes two enqueue helpers with different retry policies. **Use the matching helper for your handler's idempotency guarantees** -- this is the project's contract for what "safe to retry" means:

| Helper | Retries | Use for |
|---|---|---|
| `sendJob(name, data)` | `retryLimit: 3`, `retryBackoff: true`, `expireInMinutes: 60` (`DEFAULT_JOB_OPTIONS`) | Handlers that are safe to invoke multiple times for the same payload: pure DB reads/writes keyed by an ID, operations protected by DB-level uniqueness, embedding generation. |
| `sendJobNoRetry(name, data)` | `retryLimit: 0`, `expireInMinutes: 60` (`NO_RETRY_JOB_OPTIONS`) | Handlers with side effects that cannot be safely replayed. The canonical case is email sending: the "sent" marker is persisted *after* the external send, so a retry after a post-send DB failure would deliver a duplicate. |

### Queue Enqueue Reliability

All `queue.send()` calls are properly `await`-ed to ensure job enqueue operations complete before reporting counts. This prevents mismatches between reported and actual enqueue counts (e.g., email scheduler reporting "2 emails queued" when the jobs haven't been committed yet).

---

## Cron Scheduling (node-cron)

**Key file:** `server/cron.ts`

### Overview

The application uses [node-cron](https://github.com/node-cron/node-cron) for in-process scheduled task execution. Currently there is a single cron job registered.

### Registered Cron Jobs

#### Daily Email Check

- **Schedule**: `0 9 * * *` (every day at 09:00 UTC)
- **Timezone**: `Etc/UTC`
- **Action**: Calls `runEmailCronJob(storage)` which handles both weekly summaries (Mondays only) and missed workout reminders (daily)
- **Idempotency**: The email scheduler has built-in guards (`lastWeeklySummaryAt`, `lastMissedReminderAt`) that prevent duplicate sends even if the job runs multiple times

### Startup Catch-Up

If the server starts after 09:00 UTC (e.g., due to a deployment restart on Railway), a catch-up run is triggered after a 30-second delay:

```
const currentHour = new Date().getUTCHours();
if (currentHour >= 9) {
  setTimeout(async () => {
    await runEmailCronJob(storage);
  }, 30_000);
}
```

This ensures emails are not missed due to server restarts. The idempotency guards prevent double-sending if the scheduled run already completed before the restart.

### Lifecycle

- `startCron(storage)` -- Initializes the cron schedule. Includes a guard against duplicate starts.
- `stopCron()` -- Stops the cron task (used during graceful shutdown).

---

## Error Tracking (Sentry)

Sentry provides centralized error tracking for both server and client. It is entirely optional: a missing DSN disables initialization without affecting the rest of the app.

**Key files:**

- `server/index.ts` -- Server-side Sentry initialization with `@sentry/node`. Wraps Express with request + error handlers so unhandled rejections and uncaught exceptions surface in Sentry.
- `client/src/main.tsx` -- Client-side Sentry initialization with `@sentry/react`. The root `<App />` is wrapped in `Sentry.ErrorBoundary` with `FallbackErrorBoundary` as its fallback UI.
- `client/src/components/FeatureErrorBoundaryWrapper.tsx` -- Per-feature error boundary that reports to Sentry with a `featureName` tag so regressions can be attributed to a specific page.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SENTRY_DSN` | No | Server DSN. When absent, the `@sentry/node` init is skipped. |
| `VITE_SENTRY_DSN` | No | Client DSN. When absent, `Sentry.init` on the client is skipped. |
| `SENTRY_ENVIRONMENT` | No | Optional environment tag (e.g. `production`, `staging`). Defaults to `NODE_ENV`. |

Because the app ships without a bundled DSN, local development does not report to Sentry unless the developer explicitly opts in by setting the variables.

### What Is Reported

- **Server**: unhandled errors thrown from routes (via the Express error handler), rejected promises inside `asyncHandler`, and fatal errors from `runStartupMaintenance` before the HTTP listener binds.
- **Client**: render-time errors caught by `Sentry.ErrorBoundary` / `FeatureErrorBoundaryWrapper`, plus any explicit `Sentry.captureException` calls inside fetch wrappers.

PII-sensitive payloads (request bodies, auth headers) are scrubbed before being sent — see `beforeSend` hooks in the init calls.

---

## Startup Maintenance

**Key file:** `server/maintenance.ts`

The `runStartupMaintenance(storage)` function runs a consolidated sequence of checks and migrations every time the server starts. These ensure the database is in a consistent state before the application begins serving requests. The maintenance logic was consolidated from multiple scattered startup functions into a single sequential pipeline.

### Execution Order

1. **Test database connection** -- Attempts to connect to PostgreSQL and run `SELECT 1`. Times out after 15 seconds. If this fails, the server startup is aborted (fatal error).

2. **Run Drizzle migrations** -- Executes pending migrations from the `migrations/` folder using `drizzle-orm/node-postgres/migrator`. In production where `drizzle-kit push` is used, "already exists" errors are expected and treated as non-fatal.

3. **Ensure schema is up to date** -- Checks for and applies incremental schema changes that may not be covered by migrations:
   - Adds `ai_coach_enabled` column to `users` if missing
   - Converts `email_notifications` from integer to boolean if needed
   - Adds `goal` column to `training_plans` if missing
   - Adds `is_auto_coaching` column to `users` if missing
   - Adds `ai_source` column to `plan_days` if missing
   - Creates the `coaching_materials` table if it does not exist (with foreign key to `users` and index on `user_id`)

4. **Ensure pgvector extension** -- Runs `CREATE EXTENSION IF NOT EXISTS vector` on the vector database to enable vector similarity search.

5. **Ensure vector schema** -- Creates the `document_chunks` table on the vector database if it does not exist. Also checks that the `embedding` column uses the native `vector` type (not `text`) and converts it if needed.

6. **Clean orphaned data** -- Within a transaction, nullifies `plan_day_id` on `workout_logs` where the referenced `plan_days` row no longer exists.

7. **Backfill plan dates and workout links** -- Runs three backfill queries:
   - Sets `start_date` and `end_date` on `training_plans` from the min/max `scheduled_date` of their plan days
   - Sets `plan_id` on `workout_logs` that have a `plan_day_id` but no `plan_id`
   - Sets `plan_id` on standalone `workout_logs` (no `plan_day_id`) that fall within a training plan's date range

8. **Mark missed plan days** -- Calls `storage.markMissedPlanDays()` to flag any past planned days that were never completed.

All steps after the database connection test are non-fatal: failures are logged as warnings and the server continues to start.

---

See also: [Database -- stravaConnections Table](database.md#schema-tables), [Authentication](authentication.md), [Architecture -- Service Dependencies](architecture.md#service-dependencies)
