# API Reference

[Back to README](../README.md)

## Overview

fitai.coach exposes a RESTful API under the `/api/v1/` prefix. All endpoints require Clerk JWT authentication except the two [health probes](#health-routes), [`GET /api/v1/csrf-token`](#get-apiv1csrf-token), the Strava OAuth callback and webhook (`GET /api/v1/strava/callback`, `GET`/`POST /api/v1/strava/webhook`), the signed-token email unsubscribe link (`GET`/`POST /api/v1/emails/unsubscribe`), and the `x-cron-secret`-gated [cron trigger](#get-apiv1cronemails). Request bodies are validated with Zod schemas, and rate limiting is applied per-user per-category.

**Base URL:** `/api/v1`
**Content-Type:** `application/json` (requests and responses)
**Authentication:** Clerk JWT via `credentials: "include"` (cookie-based)

**Machine-readable spec:** a committed OpenAPI 3.0 snapshot lives at [`docs/openapi.json`](openapi.json). It is regenerated from the same Zod registry that powers Swagger UI (`shared/openapi.ts`) via `pnpm docs:openapi` and is CI-gated — the `Build` workflow fails if the committed file drifts from the schemas. Use it for client-code generation, contract testing, or importing into tools like Postman / Insomnia. Endpoints marked below that are not yet registered with the registry are **not** in the snapshot; coverage is being broadened as routes are migrated.

---

## Table of Contents

- [Error Responses](#error-responses)
- [Rate Limiting](#rate-limiting)
- [CSRF Protection](#csrf-protection)
- [Idempotency](#idempotency)
- [Request Validation](#request-validation)
- [Health Routes](#health-routes)
- [Auth Routes](#auth-routes)
- [Account Routes](#account-routes)
- [Workout Routes](#workout-routes)
- [Custom Exercise Routes](#custom-exercise-routes)
- [MAF Test Routes](#maf-test-routes)
- [Training Plan Routes](#training-plan-routes)
- [Timeline Annotation Routes](#timeline-annotation-routes)
- [Recycle Bin Routes](#recycle-bin-routes)
- [Analytics Routes](#analytics-routes)
- [AI and Chat Routes](#ai-and-chat-routes)
- [Coaching Material Routes](#coaching-material-routes)
- [Plan Proposal Routes](#plan-proposal-routes)
- [Consent Routes](#consent-routes)
- [Preferences Routes](#preferences-routes)
- [Email Routes](#email-routes)
- [Push Notification Routes](#push-notification-routes)
- [Strava Routes](#strava-routes)
- [Garmin Routes](#garmin-routes)
- [Timeline and Export Routes](#timeline-and-export-routes)
- [Nutrition Routes](#nutrition-routes)

---

## Error Responses

There are two standard error body shapes, both carrying a machine-readable `code`:

- **Global error handler** (`server/index.ts`) — thrown `AppError`s and anything else passed to `next(err)` (including CSRF failures). Handlers that respond directly — `sendNotFound`, the rate limiter, the auth guard — use the same `{ error, code }` pair.

  ```json
  {
    "error": "Human-readable error message",
    "code": "ERROR_CODE",
    "details": {}
  }
  ```

  - `details` is only included on 4xx responses whose error carries it.
  - A 500 always returns `"Internal Server Error"` to prevent leaking internals.

- **Validation middleware** (`validateBody` / `validateQuery` / `validateParams` in `server/routeUtils.ts`) — a failed Zod parse returns `400` with `message` in place of `error` (see [Request Validation](#request-validation)).

**Validation error example (400):**

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Workout date cannot be in the future",
  "details": {
    "issues": [
      { "path": "date", "message": "Workout date cannot be in the future" },
      { "path": "rpe", "message": "RPE must be at most 10" },
      {
        "path": "exercises.0.exerciseName",
        "message": "Too small: expected string to have >=1 characters"
      }
    ]
  }
}
```

**Rate limit error example (429):**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
RateLimit-Policy: 5;w=60
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 45
```

```json
{
  "error": "Too many requests. Please wait 60 seconds before trying again.",
  "code": "RATE_LIMITED"
}
```

`Retry-After` is always the full window length in seconds (the handler overwrites express-rate-limit's time-to-reset value); `RateLimit-Reset` is the seconds left in the current window.

**Not found error example (404):**

```json
{
  "error": "Workout not found",
  "code": "NOT_FOUND"
}
```

**Common HTTP status codes:**

| Status | Code                                                                                                    | Meaning                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_CSV`, `NO_SESSIONS_AFTER_START`                             | Invalid input                                                                                                                                                     |
| 401    | `UNAUTHORIZED`                                                                                          | Missing or invalid auth                                                                                                                                           |
| 403    | `EBADCSRFTOKEN`, `FORBIDDEN`, `AI_COACH_DISABLED`                                                       | Rejected rather than unauthenticated — every CSRF failure lands here as `EBADCSRFTOKEN`; `FORBIDDEN` is a Strava webhook verify-token mismatch                    |
| 404    | `NOT_FOUND`                                                                                             | Resource not found                                                                                                                                                |
| 409    | `PLAN_OVERLAP`, `PLAN_GENERATION_IN_PROGRESS`, `IDEMPOTENT_REQUEST_IN_PROGRESS`, `RECYCLE_BIN_CONFLICT` | Conflicts with current state                                                                                                                                      |
| 412    | `PRECONDITION_FAILED`                                                                                   | A precondition on the request was not met                                                                                                                         |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                     | Body exceeded the route's size limit                                                                                                                              |
| 429    | `RATE_LIMITED`, `AI_BUDGET_EXCEEDED`                                                                    | Rate limit exceeded (includes `Retry-After` header), or this user's AI spend budget is spent                                                                      |
| 500    | `INTERNAL_SERVER_ERROR`                                                                                 | Server error                                                                                                                                                      |
| 503    | `AI_FEATURES_DISABLED`, `AI_GLOBAL_BUDGET_EXCEEDED`, `AI_BUDGET_UNAVAILABLE`                            | AI is switched off for this deployment (`AI_FEATURES_ENABLED=false`), the application-wide AI spend ceiling is reached, or the budget check itself is unavailable |

`AI_GLOBAL_BUDGET_EXCEEDED` is deliberately a 503 rather than the 429 used for a
personal quota: it is a deployment-wide capacity condition that the caller did
not cause and cannot clear by waiting out their own allowance. See
[AI budget enforcement](./ai-and-rag.md#cost-controls).

---

## Rate Limiting

Rate limits are applied per-user (keyed by Clerk userId, falling back to the client IP when the request carries no Clerk session) and namespaced by category so limits are independent across route groups.

- **Default window:** 60 seconds
- **Strava routes:** 15-minute window
- **Response on limit:** `429` with `RATE_LIMITED` code and a `Retry-After` header set to the full window length in seconds
- **Headers:** `RateLimit-Policy`, `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the window resets) — the IETF draft-6 set that express-rate-limit sends for `standardHeaders: true`; legacy `X-RateLimit-*` headers are off
- **Storage:** PostgreSQL-backed `rate_limit_buckets`, shared across app replicas outside tests
- **Coverage:** every authenticated `/api/v1` route carries a limiter. Reads fail
  **open** if the Postgres store errors (a store blip must not 500 the read
  surface); everything else — every mutation, and so every auth, AI-spend and
  write route — fails **closed**.

Implementation: `server/routeUtils.ts` — `rateLimiter(category, maxRequests, windowMs)`

---

## CSRF Protection

All mutating endpoints (POST/PUT/PATCH/DELETE) require a valid CSRF token, with two exceptions that mount ahead of the guard because their callers carry neither a session cookie nor a token: [`POST /api/v1/strava/webhook`](#post-apiv1stravawebhook) (Strava's deliveries) and [`POST /api/v1/emails/unsubscribe`](#post-apiv1emailsunsubscribe) (mail clients' RFC 8058 one-click POST, authorised by its signed token alone). The token is obtained via:

### GET /api/v1/csrf-token

Retrieve a CSRF token for use in subsequent mutating requests.

- **Auth:** Not strictly required (works pre-login, bound to IP; after login, bound to userId)
- **Response:** `{ csrfToken: string }`
- **Side effects:** Sets a signed `__Host-fitai.x-csrf` cookie (production) or `fitai.x-csrf` (development)

The returned token must be sent as the `x-csrf-token` header on all mutating requests. Missing or invalid tokens result in `403 { "error": "invalid csrf token", "code": "EBADCSRFTOKEN" }` — csrf-csrf's error, rendered by the global error handler.

---

## Idempotency

Mutating endpoints support the `X-Idempotency-Key` header for safe request replay.

- **Header:** `X-Idempotency-Key` (optional, max 255 characters — a longer key gets `400 BAD_REQUEST`)
- **Behavior:** When present on a mutating request (POST/PUT/PATCH/DELETE) behind `protectedMutationGuards`, the server atomically claims `(userId, key)` — not scoped to the route — before the handler runs. Only a 2xx JSON response is cached, for 7 days; repeat requests with the same key return it without re-executing the handler. A non-2xx response releases the claim, so a retry re-executes.
- **Concurrent duplicates:** a request that arrives while the first is still running gets `409 IDEMPOTENT_REQUEST_IN_PROGRESS`. An abandoned claim expires after 60 seconds.
- **Large responses:** a 2xx body over 64 KB is cached as the sentinel `{ "idempotencyReplayed": true }` rather than in full.
- **Use case:** The client's offline queue sends this header when replaying mutations that were queued while offline, preventing duplicate state changes.

---

## Request Validation

Most protected mutation routes now use a shared builder (`protectedPost`, `protectedPatch`, `protectedDelete`) that codifies middleware order and keeps error responses consistent.

### Protected mutation builder contract

For builder-backed routes, middleware runs in this order:

1. `protectedMutationGuards` (auth + idempotency guard chain)
2. route-local limiter (`rateLimiter(...)`)
3. route-specific middleware list (typically `validateBody(...)`, `validateParams(...)`, and optional feature guards)
4. handler (wrapped with `asyncHandler` for async routes)

This ordering guarantees auth/idempotency and cost guards execute before validation or business logic, while still letting validation produce the canonical `VALIDATION_ERROR` shape. CSRF is enforced separately at router registration (`app.use("/api/v1", csrfProtection)`).

Endpoints use Zod schemas for request body validation via two patterns:

1. **`validateBody(schema)` middleware** — Parses `req.body` with the schema, returns 400 on failure, replaces `req.body` with parsed data on success.
2. **Inline `safeParse()`** — Used in routes that need custom error messages or partial validation.

Validation middleware errors return (there is no `error` key — `message` is the first issue's message):

```json
{
  "code": "VALIDATION_ERROR",
  "message": "First validation error message",
  "details": {
    "issues": [{ "path": "field.nested", "message": "Must be at least 1" }]
  }
}
```

---

## Health Routes

Unauthenticated, like the few other routes listed in the [Overview](#overview). Both are public probes with no credentials attached, so their responses deliberately carry no secrets — a failed boot reports the fixed startup _phase_, never the raw error message (that goes to `logger.fatal` server-side). Defined in `server/bootstrap/health.ts`.

### GET /api/v1/health/live

**Liveness** probe: is the process up? Wire this one to a restart policy.

- **Auth:** None
- **Response:** `200` `{ status: "alive", uptimeMs, timestamp }`
- **Errors:** `503` `{ status: "startup_failed", phase, timestamp }` when boot failed

### GET /api/v1/health

**Readiness** probe: gates on startup state plus a cached DB / vector-DB probe. A `503` here means "don't route traffic to me right now" and should **not** be wired to a restart policy.

- **Auth:** None
- **Response:** `200` `{ status: "ok", vectorSchema, uptimeMs, timestamp }`
- **Errors:** `503` with `status` of `"starting"` (still booting, plus `phase`), `"degraded"` (`db` / `vectorDb` booleans), or `"error"`

---

## Auth Routes

**File:** `server/routes/auth.ts`

### GET /api/v1/auth/user

Returns the current authenticated user's profile. Creates the user in the database if they don't exist yet (first-call sync from Clerk).

- **Auth:** Required
- **Rate limit:** `auth` category, 20/min
- **Response:** `User` object (id, email, firstName, lastName, profileImageUrl, preferences)

---

## Account Routes

**File:** `server/routes/account.ts`

### DELETE /api/v1/account

Permanently delete the authenticated user's account and all associated data (GDPR "right to erasure").

- **Auth:** Required
- **Rate limit:** `accountDelete` category, 3/min
- **Body:** none
- **Response:** `{ "success": true }` (or `404 { "error": "User not found", "code": "NOT_FOUND" }`)
- **Side effects, in order** (via `eraseAccount()` in `server/services/accountErasureService.ts`, resumable past its Clerk-delete point of no return — see the [runbook](operations/account-erasure.md)):
  1. **`users.erasure_requested_at` is stamped** before anything irreversible, then the user's private custom-food ids are captured.
  2. **RAG chunks and private-food embeddings are purged from the vector DB** (`document_chunks`, `food_embeddings` — neither is reachable by a main-DB FK cascade).
  3. **Clerk identity is deleted.** If Clerk returns HTTP 404, the identity is treated as already-deleted (idempotent retry); any other error aborts the request so the DB row is not orphaned. Without this ordering, `ensureUserExists` on the next authenticated request would silently re-provision the account.
  4. **Best-effort Strava deauthorization** — `POST https://www.strava.com/oauth/deauthorize` is called with the stored access token. Failures are logged and ignored (non-fatal).
  5. **DB user row and private custom foods are deleted in one transaction.** FK `ON DELETE CASCADE` cleans up: `workout_logs`, `exercise_sets`, `training_plans`, `plan_days`, `chat_messages`, `coaching_materials`, `strava_connections`, `garmin_connections`, `custom_exercises`, `push_subscriptions`, `ai_usage_logs`, `idempotency_keys`, and `timeline_annotations`. Public custom foods survive by explicit opt-in.
  6. **Best-effort purge** of the user's rate-limit buckets, then their queued pg-boss jobs.
  7. **Auth seen-cache eviction** — `evictUserFromSeenCache(userId)` clears the local and shared 5-minute `ensureUserExists` cache so a stale Clerk session held by another tab or replica cannot re-provision the user within the TTL window.
- **Stranded runs:** if a run dies after step 3, `runStrandedErasureSweep` (hourly cron) finds the still-stamped row and finishes it — the athlete can no longer authenticate to retry themselves.

---

## Workout Routes

**Files:** `server/routes/workouts/` — a composite router (`index.ts`) that mounts `workoutsCrud.routes.ts`, `workoutsAi.routes.ts`, `workoutsDeviceLink.routes.ts`, `workoutsTimeline.routes.ts`, `workoutsExport.routes.ts`, `workoutsMaf.routes.ts`, and `workoutsMigration.routes.ts`.

### GET /api/v1/workouts

List workout logs for the current user with pagination.

- **Auth:** Required
- **Rate limit:** `workoutList` category, 60/min
- **Query params:** `limit` (default 50, max capped), `offset` (default 0)
- **Response:** `WorkoutLog[]`

### GET /api/v1/workouts/latest

Get the most recent workout log for the current user.

- **Auth:** Required
- **Rate limit:** `workout` category, 60/min
- **Response:** `WorkoutLog` with `exerciseSets` and `structureBlocks`
- **404:** No workouts found

### GET /api/v1/workouts/:id

Get a single workout log by ID. If the workout has structure blocks but no exercise sets, the missing sets are derived from the structure on read.

- **Auth:** Required
- **Rate limit:** `workout` category, 60/min
- **Response:** `WorkoutLog` with `exerciseSets`, `structureBlocks` and `suggestedRpe`
- **`suggestedRpe`:** the RPE (1–10) the log's average heart rate suggests, which the review sheet marks in its RPE picker for the athlete to confirm. It is never saved on its own. `null` without heart rate, for lifting, yoga and Pilates, or when the athlete has neither a max HR nor an age on file. It is returned whether or not `rpe` is set; the client shows it only while `rpe` is empty. The athlete's profile is read only for a log that could get one. See [Heart-rate RPE suggestion](integrations.md) in the Strava section.
- **404:** Workout not found

### POST /api/v1/workouts

Create a new workout log, optionally with parsed exercises and/or structure blocks.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Body:** `InsertWorkoutLog` fields + optional `exercises: ParsedExercise[]` + `structureBlocks`
- **Validation:** `createWorkoutRouteSchema` (`insertWorkoutLogSchema` extended with `exercisesPayloadSchema` + `structureBlocksPayloadSchema`)
- **Server-owned fields:** `source`, `stravaActivityId`, `garminActivityId` and `startedAt` are stripped from the body. They mark a workout as a device import and are written only by the activity sync and the device-link routes, so accepting them from a client would let a manual log present itself as a Strava or Garmin recording. `planId` is likewise always derived: the server resolves plan linkage from `planDayId` (ownership-checked) or from the plan covering the workout's date, and a client-supplied `planId` is discarded.
- **Side effects:** If user has AI coach enabled, sets `isAutoCoaching` flag and queues an `auto-coach` job. A text-only write guard (`rejectTextOnlyWriteIfNeeded`) may reject the request when structured exercise data is required.
- **Response:** Created `WorkoutLog` with expanded `exerciseSets`

**Request example:**

```json
{
  "date": "2025-03-15",
  "focus": "Strength and Running",
  "mainWorkout": "4x8 back squat at 80kg, then 5km easy run",
  "accessory": "3x12 lunges, 3x15 wall balls",
  "duration": 75,
  "rpe": 7,
  "exercises": [
    {
      "exerciseName": "back_squat",
      "category": "strength",
      "confidence": 95,
      "sets": [
        { "setNumber": 1, "reps": 8, "weight": 80 },
        { "setNumber": 2, "reps": 8, "weight": 80 },
        { "setNumber": 3, "reps": 8, "weight": 80 },
        { "setNumber": 4, "reps": 8, "weight": 80 }
      ]
    },
    {
      "exerciseName": "easy_run",
      "category": "running",
      "confidence": 90,
      "sets": [{ "setNumber": 1, "distance": 5000, "time": 28 }]
    }
  ]
}
```

**Response example:**

```json
{
  "id": "wl_abc123",
  "userId": "user_456",
  "date": "2025-03-15",
  "focus": "Strength and Running",
  "mainWorkout": "4x8 back squat at 80kg, then 5km easy run",
  "accessory": "3x12 lunges, 3x15 wall balls",
  "duration": 75,
  "rpe": 7,
  "source": "manual",
  "createdAt": "2025-03-15T10:30:00.000Z",
  "exerciseSets": [
    {
      "id": "es_001",
      "workoutLogId": "wl_abc123",
      "exerciseName": "back_squat",
      "category": "strength",
      "setNumber": 1,
      "reps": 8,
      "weight": 80,
      "distance": null,
      "time": null
    },
    {
      "id": "es_002",
      "workoutLogId": "wl_abc123",
      "exerciseName": "back_squat",
      "category": "strength",
      "setNumber": 2,
      "reps": 8,
      "weight": 80,
      "distance": null,
      "time": null
    }
  ]
}
```

### PATCH /api/v1/workouts/:id

Update an existing workout log.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Body:** Partial `UpdateWorkoutLog` fields + optional `exercises: ParsedExercise[]` + `structureBlocks`
- **Validation:** `updateWorkoutRouteSchema`
- **Response:** Updated `WorkoutLog`

`planDayId` and `planId` are **not** accepted here; use
[`PATCH /api/v1/workouts/:id/plan-day`](#patch-apiv1workoutsidplan-day), which
checks that the target day belongs to the caller. This route scopes the row it
writes by `userId` but never validated the linkage _values_, so a caller could
point their own workout at another athlete's plan day — and the adherence
recompute that follows a set edit reads the prescribed sets for that day with no
owner check, writing the counts back onto the caller's row. The device-provenance
fields listed under `POST /api/v1/workouts` are stripped here too.

### DELETE /api/v1/workouts/:id

Delete a workout log and its exercise sets. The record graph is snapshotted into the [recycle bin](#recycle-bin-routes) first, so the delete can be undone for 90 days.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Response:** `{ success: true, recycleBinItemId: string }` — pass the id to `POST /api/v1/recycle-bin/:id/restore` to undo

### POST /api/v1/workouts/:id/sets

Add a single exercise set to a workout log.

- **Auth:** Required (user must own the workout)
- **Rate limit:** `workoutSet` category, 60/min
- **Body:** `addExerciseSetBodySchema`
- **Response:** `201` Created exercise set (or 404 when the workout doesn't belong to the user)

### PATCH /api/v1/workouts/:id/sets/:setId

Update a single exercise set on a workout log.

- **Auth:** Required (user must own the workout)
- **Rate limit:** `workoutSet` category, 120/min
- **Body:** `patchExerciseSetBodySchema`
- **Response:** Updated exercise set (or 404)

### DELETE /api/v1/workouts/:id/sets/:setId

Delete a single exercise set from a workout log.

- **Auth:** Required (user must own the workout)
- **Rate limit:** `workoutSet` category, 60/min
- **Response:** `{ success: true }` (or 404)

### POST /api/v1/workouts/:id/seed-from-plan

Seed a workout log's exercise sets from its linked plan day.

- **Auth:** Required
- **Rate limit:** `workoutSet` category, 20/min
- **Response:** `{ seededCount: number }`

### PATCH /api/v1/workouts/:id/plan-day

Attach workout log `:id` to a plan day, move it to a different one, or detach it entirely by sending `null`.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Body:** `{ planDayId: string | null }` — `null` detaches
- **Response:** the updated `WorkoutLog`
- **Errors:** `400` (validation), `404` (workout not found)

This is the **only** way to change a workout's plan linkage. The target day is
resolved with `getPlanDay(planDayId, userId)`, so a day belonging to another
athlete reads as not found; `planId` is then derived from the day rather than
taken from the request.

### POST /api/v1/workouts/:id/device-link

Merge a standalone Strava import (`:id`) into the plan day or the manually logged workout it was a recording of. The recording's metrics fill only the target's NULL columns and the standalone row is removed. A manual link is never revisited by the sync. See [Integrations → Activity Sync](integrations.md#activity-sync) for how the sync links automatically.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Body:** exactly one of `{ planDayId: string }` or `{ workoutLogId: string }`
- **Response:** the merged `WorkoutLog`
- **Errors:** `400` (no target, both targets, or unknown fields), `404` (import or plan day not found), `409` (not a Strava import, already linked, or the target already carries a device activity)

### DELETE /api/v1/workouts/:id/device-link

Take the linked Strava activity off workout log `:id` and give it back its own row. An enriched manual log keeps everything the athlete typed and loses exactly the columns the link filled; a plan-day log the sync created is deleted and the day's status re-derived.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Response:** `{ log: WorkoutLog | null, standalone: WorkoutLog }` — `log` is `null` when the row only existed because of the link
- **Errors:** `404` (workout not found), `409` (no linked activity to remove)

### DELETE /api/v1/workouts/:id/device-link/suggestion

"Not this one": drop the plan day or workout the sync suggested for standalone Strava import `:id`. The import itself is untouched; the suggestion columns go back to NULL so the timeline stops offering it, and a re-sync cannot revive it because the activity is already imported.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Response:** the updated `WorkoutLog`
- **Errors:** `404` (workout not found)

### PATCH /api/v1/workouts/:id/structure-blocks/:blockId/score

Set or clear the score on a single structure block of a workout log.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Body:** `{ score: StructureBlockScore | null }`
- **Response:** `{ structureBlocks }` (or 404)

### GET /api/v1/workouts/:id/history

Get history stats for a workout log.

- **Auth:** Required
- **Rate limit:** `workoutHistory` category, 60/min
- **Response:** Workout history stats (or 404)

### POST /api/v1/workouts/bulk-delete

Delete multiple workout logs and/or plan days in a single request.

- **Auth:** Required
- **Rate limit:** `workoutBulkDelete` category, 20/min
- **Body:** `{ workoutLogIds: string[], planDayIds: string[] }` — each capped at 100 entries, at least one id required
- **Response:** `{ success: true, deletedWorkoutLogIds, deletedPlanDayIds, deletedCount, batchId: string, recycleBinItemIds: string[] }` (or 404 when a target is not found). Every deleted record lands in the [recycle bin](#recycle-bin-routes) under the one `batchId`, so `POST /api/v1/recycle-bin/batches/:batchId/restore` undoes the whole bulk delete.

### POST /api/v1/workouts/combine

Combine multiple workout logs into a single new workout, deleting the sources. The sources' exercise sets are moved onto the merged workout before the delete, so the sources do **not** go to the recycle bin — combine is permanent.

- **Auth:** Required
- **Rate limit:** `workout` category, 10/min
- **Body:** `{ newWorkout: InsertWorkoutLog, deleteWorkoutIds: string[] (1-10), skipPlanDayIds?: string[] (max 10) }`
- **Response:** `201` Created `WorkoutLog`

### GET /api/v1/workouts/unstructured

List workouts that have no parsed exercise sets (candidates for reparsing).

- **Auth:** Required
- **Rate limit:** `workoutList` category, 60/min
- **Response:** `WorkoutLog[]`

### POST /api/v1/workouts/:id/reparse

Re-parse a single workout's text into structured exercise sets using the configured text AI provider. Writes the parsed sets through; responds `422 PARSE_WRITE_THROUGH_REQUIRED` when parsing produces no persisted sets.

- **Auth:** Required (user must own the workout)
- **Rate limit:** `reparse` category, 5/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** Optional `{ prescribedMainWorkout?: string | null, prescribedAccessory?: string | null }`
- **Response:** `{ exercises: ParsedExercise[], saved: boolean, setCount: number, rejectedCount: number, rejectionReasons: string[] }`

### POST /api/v1/workouts/batch-reparse

Re-parse all unstructured workouts for the current user.

- **Auth:** Required
- **Rate limit:** `batchReparse` category, 2/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Response:** `{ total: number, parsed: number, failed: number }`

### GET /api/v1/workouts/migration/reviews

List assisted-migration backfill reviews for the current user.

- **Auth:** Required
- **Rate limit:** `migrationReviews` category, 20/min
- **Query:** `ownerType?` (`workoutLog` | `planDay`), `ownerId?` — must be supplied together
- **Response:** Backfill review list

### POST /api/v1/workouts/migration/backfill

Run an assisted-migration backfill pass for the current user.

- **Auth:** Required
- **Rate limit:** `migrationBackfill` category, 2/min
- **Response:** Backfill result summary

### POST /api/v1/workouts/migration/reviews/resolve

Resolve a single assisted-migration backfill review.

- **Auth:** Required
- **Rate limit:** `migrationReviewResolve` category, 20/min
- **Body:** `{ ownerType: "workoutLog" | "planDay", ownerId: string, action: "accept" | "reject" | "edit", reason?: string | null }`
- **Response:** `{ ok: true }` (or 404 when the target is not found)

---

## Custom Exercise Routes

**File:** `server/routes/workouts/workoutsCrud.routes.ts`

### GET /api/v1/custom-exercises

List all custom exercises defined by the current user.

- **Auth:** Required
- **Rate limit:** `customExercise` category, 60/min
- **Response:** `CustomExercise[]`

### POST /api/v1/custom-exercises

Create or upsert a custom exercise.

- **Auth:** Required
- **Rate limit:** `customExercise` category, 20/min
- **Body:** `{ name: string, category?: string }` (`category` defaults to `"conditioning"`)
- **Validation:** `createCustomExerciseSchema` (`insertCustomExerciseSchema` without `userId`)
- **Response:** `CustomExercise`

---

## MAF Test Routes

Tagging a logged run as a MAF (Maximum Aerobic Function) test records a `maf_test_results` row and, when the run carries heart-rate data, a `maf_workout_analysis` compliance row scored against the athlete's current aerobic ceiling. **Files:** `server/routes/workouts/workoutsMaf.routes.ts`, `server/services/mafTestService.ts`.

### POST /api/v1/workouts/:id/maf-test

Tag an already-logged run as a MAF test.

- **Auth:** Required
- **Rate limit:** `mafTest` category, 20/min
- **Body:** `{ protocolType?: string (≤120), notes?: string (≤2000), metrics?: { avgHeartRate?, maxHeartRate?, durationSeconds?, distanceMeters? } }` — every metric is nullable and optional; an omitted field keeps the auto-pulled value, an explicit `null` clears it. `maxHeartRate` may not be below `avgHeartRate`.
- **Response:** `201` with the test record on first tag; `200` with the same record when an already-tagged workout is returned idempotently
- **Errors:** `400` (validation), `404` (workout not found)

### PATCH /api/v1/workouts/:id/maf-test

Apply manual HR / duration / distance corrections to a tagged test and recompute its compliance analysis against the athlete's current ceiling.

- **Auth:** Required
- **Rate limit:** `mafTest` category, 20/min
- **Body:** same shape as the `POST`
- **Response:** `{ testResult, analysis }`
- **Errors:** `400` (validation), `404` (workout not tagged)

### DELETE /api/v1/workouts/:id/maf-test

Untag a workout, removing its MAF test and compliance analysis, so an accidental tag can be undone from the review surface.

- **Auth:** Required
- **Rate limit:** `mafTest` category, 20/min
- **Response:** `{ success: true }`
- **Errors:** `404` (workout not tagged)

### GET /api/v1/maf-tests

MAF test history and compliance trend, for the trend charts and the coach.

- **Auth:** Required
- **Rate limit:** `mafTest` category, 60/min
- **Response:** `{ tests, analysis }` — up to 200 rows each

---

## Training Plan Routes

**File:** `server/routes/plans.ts`

### GET /api/v1/plans

List all training plans for the current user.

- **Auth:** Required
- **Rate limit:** `planRead` category, 60/min
- **Response:** `TrainingPlan[]`

### GET /api/v1/plans/:id

Get a training plan with all its days.

- **Auth:** Required
- **Rate limit:** `planRead` category, 60/min
- **Response:** `TrainingPlanWithDays`

### POST /api/v1/plans/import

Import a training plan from CSV content.

- **Auth:** Required
- **Rate limit:** `planImport` category, 5/min
- **Body:** `{ csvContent: string, fileName?: string, planName?: string }`
- **Validation:** `importPlanRequestSchema` (csvContent max 100,000 chars)
- **Response:** `TrainingPlanWithDays`

### POST /api/v1/plans/sample

Create the built-in sample Hyrox training plan. Onboarding passes the goal the athlete picked and any race date they gave, so a template plan keeps them (the coach reads the plan's goal); the Timeline sends an empty body.

- **Auth:** Required
- **Rate limit:** `planSample` category, 5/min
- **Body (optional):** `{ goal?: string (max 500), raceDate?: "YYYY-MM-DD" }`
- **Validation:** `createSamplePlanSchema`
- **Response:** `TrainingPlanWithDays` (unscheduled; follow with [`POST /api/v1/plans/:planId/schedule`](#post-apiv1plansplanidschedule))

### POST /api/v1/plans/generate

Kick off an **asynchronous** AI training-plan generation. The request creates a _pending_ plan immediately, enqueues a background `plan-generation` job (see [Integrations — Job Queue](integrations.md#job-types)), and returns the stub so the client can poll for completion.

- **Auth:** Required
- **Rate limit:** `planGenerate` category, 3/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** `GeneratePlanInput` — `{ goal, totalWeeks (1-24), daysPerWeek (2-7), experienceLevel, raceDate?, startDate?, restDays?, focusAreas?, injuries? }`
- **Validation:** `generatePlanInputSchema`
- **Response:** `202 Accepted` with the pending `TrainingPlan` stub. Poll [`GET /api/v1/plans/:id/generation-status`](#get-apiv1plansidgeneration-status) for progress.
- **`supersedePlanIds?: string[]`** (max 5): plans the athlete is switching away from. They are retired **only** once this plan generates successfully, atomically with the flip to `ready`, and effective from the later of the new plan's start date and today. A failed or timed-out generation retires nothing, so the athlete is never left without an active plan.
- **`409 PLAN_GENERATION_IN_PROGRESS`:** Returned when the user already has a generation in flight (`hasInFlightPlanGeneration`), so rapid re-submits (triple-clicks, retries) can't enqueue parallel jobs that each burn AI budget and race to write the same user's plans.

### GET /api/v1/plans/:id/generation-status

Poll the status of an asynchronous plan generation.

- **Auth:** Required
- **Rate limit:** `planStatus` category, 60/min
- **Response:** `{ planId: string, generationStatus: "pending" | "generating" | "ready" | "failed", error?: string }` (404 when the plan is not found)
- **`error` is a client-safe message, never a raw exception.** Only messages from
  the app's own `AppError` (already written for users) are surfaced; anything
  else — provider, database driver or HTTP-layer text, which can name internal
  hosts, models or query fragments — is replaced with a generic
  "Plan generation failed unexpectedly. Please try again." The full error still
  goes to the logs and Sentry, which is where triage happens.

### PATCH /api/v1/plans/:id

Rename a training plan.

- **Auth:** Required
- **Rate limit:** `planUpdate` category, 20/min
- **Body:** `{ name: string }` (1-255 chars)
- **Response:** Updated `TrainingPlan`

### PATCH /api/v1/plans/:id/goal

Update a training plan's goal.

- **Auth:** Required
- **Rate limit:** `planUpdate` category, 20/min
- **Body:** `{ goal: string | null }` (max 500 chars)
- **Response:** Updated `TrainingPlan`

### PATCH /api/v1/plans/:id/retirement

Archive a training plan from a date, or restore it.

- **Auth:** Required
- **Rate limit:** `planUpdate` category, 20/min
- **Body:** `{ retiredOn: string | null }` — an ISO `YYYY-MM-DD`, or `null` to restore
- **Response:** Updated `TrainingPlan`
- **`404`:** Plan not found (or not the caller's)
- **`409 PLAN_OVERLAP`:** Returned on a restore that would leave two live plans covering the same days — the state the lifecycle column exists to prevent. The message names the plan in the way.

`retiredOn` is a half-open cutoff: the plan stays the athlete's active plan for
every date before it. It is clamped forward to the athlete's own local today, so
a back-dated value is accepted but takes effect from today — a past cutoff would
strand days the missed-day sweep has already written, which `missed → planned`
forbids undoing.

### PATCH /api/v1/plans/:planId/days/:dayId

Update a plan day. Despite the path, `:planId` is not checked: the day is looked up by `dayId` and the caller's `userId`.

- **Auth:** Required
- **Rate limit:** `planDayUpdate` category, 20/min
- **Body:** Partial plan day (focus, mainWorkout, accessory, notes, scheduledDate, expectedDurationMin, expectedRpe, plannedTimeOfDayMin, priority)
- **Validation:** `updatePlanDayRouteSchema`
- **Response:** Updated `PlanDay`

`priority` is the session's tier — `"key" | "supporting" | "optional"`, or
`null` to go back to the tier inferred from the day's title.

`status` and `skipReason` are **not** accepted here — use
[`PATCH /api/v1/plans/days/:dayId/status`](#patch-apiv1plansdaysdayidstatus),
which enforces the legal status transitions. The AI-provenance columns
(`aiSource`, `aiRationale`, `aiInputsUsed`, `aiNoteUpdatedAt`) and the recovery
record (`recovery`, `missedOn`) are server-managed and are likewise stripped
from the body;
writing `aiNoteUpdatedAt` directly would have let a client bypass the
coach-note regeneration cooldown. `updatePlanDaySchema`
remains the internal write surface used by the coach and suggestion services.

### PATCH /api/v1/plans/days/:dayId

Update a plan day (`updatePlanDayWithCleanup` in `server/services/planService.ts`). It cannot change `status` directly and does not touch linked workout logs; it differs from the scoped route above only in what an actual `scheduledDate` change does: it queues a debounced `auto-coach` run, and it folds a missed session moved forward.

- **Auth:** Required
- **Rate limit:** `planDayUpdate` category, 20/min
- **Body:** Same client-writable fields as the scoped route above (`updatePlanDayRouteSchema`)
- **Response:** Updated `PlanDay`

Moving a missed session to today or later makes it planned again and records
it as folded (`recovery: "folded"`, `missedOn` = the date it was missed), the
same as folding it through [missed-session recovery](#get-apiv1plansdaysdayidrecovery).

### PATCH /api/v1/plans/days/:dayId/status

Update only the status, scheduled date and/or skip reason of a plan day.

- **Auth:** Required
- **Rate limit:** `planDayStatus` category, 20/min
- **Body:** `{ status?: "planned" | "completed" | "missed" | "skipped", scheduledDate?: string | null, skipReason?: "ill" | "injured" | "schedule" | "low_energy" | null }`
- **Response:** Updated `PlanDay`
- **Notes:** `skipReason` is only meaningful alongside `status: "skipped"` — any
  other status clears it. Omitting the key leaves an existing reason untouched;
  sending `null` clears it explicitly. Sending only `scheduledDate` (no `status`)
  takes the reschedule path and skips the status-transition check.
  A status change away from `missed` clears a let-go (`recovery: "let_go"`), and
  moving a missed day to today or later folds it, as on
  `PATCH /api/v1/plans/days/:dayId`.

### GET /api/v1/plans/days/:dayId/recovery

What each way forward for a missed session would do to the plan
(`getMissedSessionRecoveryPreview` in `server/services/missedRecovery`). The
preview is computed from the athlete's own timeline, in their timezone, read
across the missed session's week and the weeks of the days it could move to.

- **Auth:** Required
- **Rate limit:** `planDayRecoveryRead` category, 60/min
- **Response:** `MissedSessionRecoveryPreview` (`shared/schema/types/recovery.ts`):
  - `priority` — the session's tier; `session` — its estimated length and RPE
  - `fold` / `shorten` — `{ available, unavailableReason, suggestedDate, targets }`,
    one target per day it could move to (today and the next six days, inside the
    plan, before race day, outside absences). `suggestedDate` is the option's
    best day: the recommendation's own day for the recommended option, otherwise
    the best day without cautions (then without severe ones), where sooner,
    same-week and lighter days rank higher. Each target lists the sessions
    already on that day and the option's `impact`: the day's minutes after the
    move, each changed week's minutes, load (UTSS) and key sessions before and
    after, and `notes` (`stacked_key`, `back_to_back_key`, `hard_neighbor`,
    `long_day`, `week_jump`, `race_close` cautions; `optional_on_day`,
    `blocks_not_trimmed`, `not_trimmable` tips). `shorten` also carries the
    shortened `durationMin`, `keptFraction` and the per-exercise `changes`.
  - `letGo.impact` — the same impact for leaving the session where it is
  - `recommendation` — `{ action, targetDate, reason }`, chosen by tier: an
    optional session is let go; a key one is folded into a day with no
    cautions, else shortened onto a day without a severe one (`race_close`,
    `stacked_key`, `back_to_back_key`), else let go; a supporting one is folded
    only into a caution-free day in its own week, else shortened onto a
    caution-free day, else let go. A session missed again after a move is let
    go unless it is key and a shorter version still fits
- **`404`:** Plan day not found, unscheduled, or not the caller's
- **`409 CONFLICT`:** The day isn't missed (including a past day an absence
  excuses), is a rest day, or falls on or after its plan's retirement date

Folding and shortening are unavailable (`available: false`, only letting go is
offered) for a session missed more than seven days ago, a race-week day, or
when no day in the window qualifies.

### POST /api/v1/plans/days/:dayId/recovery

Carry out the athlete's choice for a missed session
(`applyMissedSessionRecovery`).

- **Auth:** Required
- **Rate limit:** `planDayRecovery` category, 20/min
- **Body:** one of `{ action: "fold", targetDate }`, `{ action: "shorten", targetDate }`,
  `{ action: "let_go" }`, `{ action: "reopen" }`
- **Validation:** `applyMissedRecoverySchema`
- **Response:** `{ day: PlanDay }`
- **`400`:** `targetDate` is not one of the preview's targets
- **`404`:** Plan day not found
- **`409 CONFLICT`:** Same as the preview; also when the chosen option is
  unavailable, when `reopen` targets a day that was not let go, or when the day
  changed (status, date or recovery) between reading and writing

- `fold` moves the session to `targetDate` as planned, with `recovery: "folded"`
  and `missedOn` set to the date it was missed.
- `shorten` does the same with `recovery: "shortened"` and cuts the prescription
  to about 60%: the last sets of each exercise are dropped, a single continuous
  effort is scaled down, and timed structure blocks are left alone. When the
  table can't show the cut, `expectedDurationMin` is pinned to the shorter
  length and the notes gain a line saying how much of the session to do.
- `let_go` leaves the session on its day as `missed` with `recovery: "let_go"`;
  it drops out of the missed-workout reminder, the weekly review lists it as
  let go rather than missed, and the coach is told not to add it back. It still
  counts as missed for adherence.
- `reopen` undoes a let-go. A session that had already been moved once before
  it was let go comes back as moved (`recovery: "folded"`), so the planner
  doesn't chase it as if it had never been.

The move and the prescription change are written in one transaction, guarded on
the day's status, date and recovery. `fold` and `shorten` queue a debounced
`auto-coach` run.

### DELETE /api/v1/plans/:id

Delete a training plan and all its days (cascade). The plan, its days and their prescribed sets are snapshotted into the [recycle bin](#recycle-bin-routes) first; workout logs that pointed at the plan stay on the timeline as unplanned sessions and are re-linked on restore.

- **Auth:** Required
- **Rate limit:** `planDelete` category, 10/min
- **Response:** `{ success: true, recycleBinItemId: string }`

### DELETE /api/v1/plans/days/:dayId

Delete a single plan day. Snapshotted into the [recycle bin](#recycle-bin-routes) first; a workout logged against the day keeps its log (unlinked) and is re-linked on restore.

- **Auth:** Required
- **Rate limit:** `planDayDelete` category, 10/min
- **Response:** `{ success: true, recycleBinItemId: string }`

### POST /api/v1/plans/:planId/schedule

Schedule a plan by assigning dates to its days from a given start date. Week 1 is the Monday-anchored week that contains `startDate`, so every day keeps its weekday. No session is placed before `startDate`: a week-1 day that would land earlier is left unscheduled (`scheduledDate: null`, off the timeline) instead of back-dated into the past, where it would read as missed. A day the athlete already completed, skipped or logged a workout against keeps its date. The plan's own `startDate` is week 1's Monday; its `endDate` is the last scheduled day.

- **Auth:** Required
- **Rate limit:** `planSchedule` category, 10/min
- **Body:** `{ startDate: "YYYY-MM-DD" }`
- **Validation:** `schedulePlanRequestSchema`
- **Response:** `{ success: true }`; 404 for a plan the athlete does not own; 400 `NO_SESSIONS_AFTER_START` when every session of a one-week plan falls before `startDate`

### GET /api/v1/plans/days/:dayId/sets

List the exercise sets for a plan day. With `?includeStructure=true`, also returns structure blocks (and derives missing sets from structure when needed).

- **Auth:** Required
- **Rate limit:** `planDaySet` category, 60/min
- **Query:** `includeStructure?` (`"true"`)
- **Response:** `ExerciseSet[]`, or `{ exerciseSets, structureBlocks }` when `includeStructure=true` (or 404)

### POST /api/v1/plans/days/:dayId/sets

Add a single exercise set to a plan day.

- **Auth:** Required
- **Rate limit:** `planDaySet` category, 60/min
- **Body:** `addExerciseSetBodySchema`
- **Response:** `201` Created exercise set (or 404)

### PATCH /api/v1/plans/days/:dayId/sets/:setId

Update a single exercise set on a plan day.

- **Auth:** Required
- **Rate limit:** `planDaySet` category, 120/min
- **Body:** `patchExerciseSetBodySchema`
- **Response:** Updated exercise set (or 404)

### DELETE /api/v1/plans/days/:dayId/sets/:setId

Delete a single exercise set from a plan day.

- **Auth:** Required
- **Rate limit:** `planDaySet` category, 60/min
- **Response:** `{ success: true }` (or 404)

### PATCH /api/v1/plans/days/:dayId/structure

Replace the structure blocks of a plan day.

- **Auth:** Required
- **Rate limit:** `planDaySet` category, 60/min
- **Body:** `{ structureBlocks: StructureBlock[] }`
- **Response:** The updated plan day structure (or 404)

### POST /api/v1/plans/days/:dayId/reparse

Re-parse a plan day's `mainWorkout`/`accessory` text into structured exercise sets, replacing existing prescribed rows. Responds `422 PARSE_WRITE_THROUGH_REQUIRED` when parsing produces no persisted sets.

- **Auth:** Required
- **Rate limit:** `planDayReparse` category, 5/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** Optional `{ mainWorkout?: string | null, accessory?: string | null }`
- **Response:** `{ exercises, saved: true, setCount, rejectedCount, rejectionReasons }` (or 404)

### POST /api/v1/plans/days/:dayId/reparse-from-image

Photo sibling of `/reparse` — re-parse a plan day's prescribed exercises from an uploaded image. Same replace semantics.

- **Auth:** Required
- **Rate limit:** `planDayReparse` category, 5/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** `{ imageBase64, mimeType }`
- **Response:** Same shape as `/reparse` (or 404)

### POST /api/v1/plans/days/:dayId/coach-note/regenerate

Manually refresh the AI coach note (`ai_rationale`) for a planned day. The service enforces a 30-second cooldown.

- **Auth:** Required
- **Rate limit:** `coachNoteRegenerate` category, 10/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Response:** The updated plan day, or `429 COOLDOWN` (with `Retry-After` header) when called inside the cooldown window

---

## Timeline Annotation Routes

**File:** `server/routes/timelineAnnotations.ts`

User-authored bands spanning `[startDate, endDate]` that annotate injury, illness, travel, or rest periods on the Timeline and as shaded bands on Analytics charts. The DB layer (`timeline_annotations` table) enforces `type IN ('injury','illness','travel','rest')` and `end_date >= start_date`. Per-user ownership is enforced at the storage layer — mismatched IDs silently return 404 to avoid leaking existence.

### GET /api/v1/timeline-annotations

List all annotations for the authenticated user, ordered by `startDate` ASC.

- **Auth:** Required
- **Rate limit:** `annotations` category, 60/min
- **Response:** `TimelineAnnotation[]`

### POST /api/v1/timeline-annotations

Create a new annotation.

- **Auth:** Required
- **Rate limit:** `annotations` category, 20/min
- **Body:** `{ startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", type: "injury" | "illness" | "travel" | "rest", note?: string }` (`note` max 500 chars)
- **Validation:** `insertTimelineAnnotationSchema` (Zod), with a `.refine` that `endDate >= startDate` when both dates are present
- **Response:** `201 TimelineAnnotation`

### PATCH /api/v1/timeline-annotations/:id

Partially update an annotation. The handler fetches the existing row, merges the partial over it, and re-checks the date bounds before writing so a single-field PATCH cannot slip an invalid range past Zod.

- **Auth:** Required
- **Rate limit:** `annotations` category, 20/min
- **Body:** Partial `{ startDate?, endDate?, type?, note? }`
- **Validation:** `updateTimelineAnnotationSchema`
- **Response:** `TimelineAnnotation` (or 404 when the id doesn't belong to the user)

### DELETE /api/v1/timeline-annotations/:id

Delete an annotation.

- **Auth:** Required
- **Rate limit:** `annotations` category, 20/min
- **Response:** `{ success: true }` (or 404 when the id doesn't belong to the user)

---

## Recycle Bin Routes

**File:** `server/routes/recycleBin.ts`

Deleted workout logs, plan days and training plans are snapshotted into the `recycle_bin_items` table (see [database.md](database.md#recycle_bin_items)) at delete time and can be restored for **90 days**; the `recycleBinPurge` cron removes expired items nightly. Restore re-inserts the record with its original id and re-attaches whatever the delete detached (a workout's plan-day link and MAF analysis, a plan day's logged workouts). Items are scoped to the authenticated user at the storage layer — another user's id, an expired item, or an unknown id all return 404.

The client uses these in two places: an **Undo** action on the delete toast (single item or bulk-delete batch) and the **Recycle bin** tab under Settings (`?tab=recycle-bin`).

While a device-imported workout sits in the bin, the Strava and Garmin syncs treat its activity id as already imported, so the next sync does not re-create the workout the athlete just deleted. After _Delete forever_ or expiry the activity can be imported again if it is still inside the provider's fetch window.

### GET /api/v1/recycle-bin

List the user's restorable items, newest first (capped at 500), without payloads.

- **Auth:** Required
- **Rate limit:** `recycleBin` category, 60/min
- **Response:** `{ items: RecycleBinListItem[], counts: { total, workout_log, plan_day, training_plan } }` where each item is `{ id, entityType, entityId, batchId, label, summary, entityDate, childCount, deletedAt, expiresAt }`

### POST /api/v1/recycle-bin/:id/restore

Restore one item and remove it from the bin.

- **Auth:** Required
- **Rate limit:** `recycleBinMutation` category, 20/min
- **Response:** `{ ok: true, entityType, entityId, batchId, warnings: string[] }` — `warnings` lists anything that could not be put back exactly (e.g. the plan day a workout belonged to no longer exists, so it was restored unplanned)
- **Errors:**
  - `404` — unknown, expired, or another user's item; or, for a plan day, the parent plan has been deleted (restore the plan first)
  - `409 PLAN_OVERLAP` — restoring a live training plan whose dates overlap another live plan (archive that plan first, same rule as [`PATCH /api/v1/plans/:id/retirement`](#patch-apiv1plansidretirement))
  - `409 RECYCLE_BIN_CONFLICT` — a record with the same id or the same Strava/Garmin activity id already exists (a race with a concurrent sync)

### POST /api/v1/recycle-bin/batches/:batchId/restore

Restore every item a single bulk delete produced, all-or-nothing: if any item cannot be restored the whole batch is rolled back and the failure reported.

- **Auth:** Required
- **Rate limit:** `recycleBinMutation` category, 20/min
- **Response:** `{ ok: true, batchId, restored: Array<{ entityType, entityId }>, warnings: string[] }`
- **Errors:** as for single restore; `404` when the batch has no restorable items

### DELETE /api/v1/recycle-bin/:id

Permanently delete one item ("Delete forever").

- **Auth:** Required
- **Rate limit:** `recycleBinMutation` category, 20/min
- **Response:** `{ success: true }` (or 404)

### DELETE /api/v1/recycle-bin

Empty the bin.

- **Auth:** Required
- **Rate limit:** `recycleBinEmpty` category, 5/min
- **Response:** `{ success: true, purgedCount: number }`

---

## Analytics Routes

**File:** `server/routes/analytics.ts`

All analytics endpoints support optional date filtering via query parameters: `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

**Coalesced request cache.** Exercise sets, the column-slim sets behind personal records, and workout logs used by these routes pass through three in-memory promise caches (`getExerciseSetsCoalesced`, `getPersonalRecordSetsCoalesced` and `getWorkoutLogsCoalesced`, each built by `createCoalescedCache()` in `server/services/analyticsRouteCache.ts`) keyed by `userId + from + to`. The cache holds the _pending_ promise, so three concurrent requests for the same user/window trigger a single database query. Parameters:

| Knob                  | Value                                                                  | Source                                   |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| TTL                   | 5 minutes (`ANALYTICS_CACHE_TTL_MS`)                                   | `server/constants.ts`                    |
| Max entries per cache | 500 (`MAX_CACHE_SIZE`)                                                 | `server/services/analyticsRouteCache.ts` |
| Eviction              | Expired entries first, then oldest-by-timestamp once over the size cap | `evictStale()` (same file)               |
| Failure behavior      | The rejected promise is evicted so the next caller retries immediately | `.catch` in `createCoalescedCache()`     |

### GET /api/v1/personal-records

Calculate personal records across all exercises.

- **Auth:** Required
- **Rate limit:** `analytics` category, 20/min
- **Query:** `from?`, `to?`
- **Response:** `PersonalRecord[]` — max weight, max distance, best time per exercise category

### GET /api/v1/exercise-analytics

Calculate per-exercise analytics (volume, intensity trends).

- **Auth:** Required
- **Rate limit:** `analytics` category, 20/min
- **Query:** `from?`, `to?`
- **Response:** Exercise analytics breakdown

### GET /api/v1/training-overview/summary

The home summary card's payload: only the numbers the card renders, from bounded reads (the distinct completed dates for the streak, the trailing 180 days of logs and sets for this week's count and the station radar). Keyed on the client as a child of the training-overview query so overview invalidations refresh it too.

- **Auth:** Required
- **Rate limit:** `analytics` category, 20/min
- **Response shape:**

  ```ts
  {
    currentStreak: number,
    weeklyCompletedWorkouts: number,
    weeklyGoal: number,
    stationCoverage: { station: string; lastTrained: string | null; daysSince: number | null }[],
    coverageLookbackDays: number, // a station outside the window reports lastTrained: null
  }
  ```

### GET /api/v1/training-overview

Calculate weekly training summaries, category totals, station coverage, and week-over-week deltas.

- **Auth:** Required
- **Rate limit:** `analytics` category, 20/min
- **Query:** `from?`, `to?`
- **Response shape:**

  ```ts
  {
    weeklySummaries: WeeklySummary[],
    workoutDates: string[],
    categoryTotals: { /* per-category totals */ },
    stationCoverage: { /* Hyrox station coverage */ },
    currentStats: {
      totalWorkouts: number,
      avgPerWeek: number,
      totalDuration: number,
      avgDuration: number,
      avgRpe: number | null,
    },
    // Omitted when no meaningful previous window exists — e.g. the user
    // picked "all time" so `from` is absent.
    previousStats?: {
      totalWorkouts: number,
      avgPerWeek: number,
      totalDuration: number,
      avgDuration: number,
      avgRpe: number | null,
    },
    // UTSS, ACWR, Form, monotony and the governor's restrictions over the
    // trailing 70-day load window ending on `to` (or today).
    trainingLoad: TrainingLoadOverview,
    // The same window's sessions split by body system: session RPE × minutes
    // spread across aerobic, running impact, leg muscle and upper-body pull,
    // six rolling 7-day blocks per system, each against its own usual week.
    bodySystemLoad: BodySystemLoadOverview,
  }
  ```

- **Previous-window derivation (`computePreviousWindow`):** The previous period is the equal-length, non-overlapping range ending the day before `from`. If `to` is omitted, the current window's upper bound is pinned to midnight UTC of today (not wall-clock `now`) so the previous window doesn't drift across the day. Returns `null` when `from` is absent, and the route responds without `previousStats`.
- The client's `DeltaIndicator` component renders the percentage change between `currentStats` and `previousStats` for each of the six stat cards.
- **Load by body system (`bodySystemLoad`):** each session's load is its RPE × minutes (Foster session-RPE). A session with no RPE uses its heart-rate equivalent, then the default effort of what was logged; one with no duration uses an estimate from its sets; both are counted in `estimatedSessions`. The load is split by each exercise's profile, weighted by its share of the session's time, and each system is compared with the mean of the up-to-four full weeks before this one (`ratio` bands 0.8 / 1.3 / 1.5). `sixWeekHigh` needs six weeks of history and a week at least 20% above the usual one. A parallel model: it never feeds UTSS or the governor. Types in `shared/schema/types/analytics.ts`; model in `server/services/trainingLoad/bodySystemLoad.ts`.

### GET /api/v1/weekly-review

The athlete's own Monday→Sunday week: completion against plan, prior-week comparison, PRs, annotations, and the intent they set for this week and last. Not persisted and not AI-gated — four bounded queries over data the weekly summary email already reads. See [weekly-review-spec.md](weekly-review-spec.md).

- **Auth:** Required
- **Rate limit:** `analytics` category, 20/min
- **Query:** `week` (optional) — any date inside the wanted week; defaults to the last completed week. The week is resolved in the athlete's `userTimezone` (falling back to UTC) and the payload reports the zone it was actually resolved in.
- **Errors:** `400` (`Invalid 'week' date format`)

### POST /api/v1/weekly-review/intent

Write or clear the athlete's intent for a week. `POST` rather than `PUT` despite being an idempotent upsert: the repo has no `PUT` routes, and the protected-route builder only knows `post` / `patch` / `delete`.

- **Auth:** Required
- **Rate limit:** `analytics` category, 20/min
- **Body:** `{ week: string, intent?: string | null }` — the date is anchored server-side to its Monday, since the unique index is on `(user_id, week_start)`. A blank or `null` intent clears the week's line.
- **Response:** `{ weekStart, intent }`
- **Errors:** `400` (validation)

### GET /api/v1/race-prediction

Predict the athlete's HYROX finish time from their logged history. **Stored-first**: returns the last persisted prediction instantly (no AI spend) so the tab paints on open without a spinner; `?refresh=1` (the manual refresh button) — or the absence of any stored row — regenerates and persists a fresh prediction. The stored row is also kept warm by the midnight [analytics recompute job](integrations.md#job-types).

- **Auth:** Required
- **Rate limit:** `race-prediction` category, 12/min
- **AI gates:** None — the service degrades to a deterministic estimate when AI is disabled, unconsented, or over budget, and only calls the model when consent + budget allow.
- **Query:** `refresh?` — `refresh=1` forces regeneration and persistence
- **Response:** `RacePredictionResponse & { generatedAt: string, stale: boolean }` — on a stored read, `stale` is `true` when a workout was logged after `generatedAt`; a freshly generated prediction returns `stale: false`.

---

## AI and Chat Routes

**File:** `server/routes/ai.ts`

### POST /api/v1/parse-exercises

Parse free-text or voice input into structured exercise data using the configured text AI provider.

- **Auth:** Required
- **Rate limit:** `parse` category, 5/min
- **Body:** `{ text: string }` (1-2000 chars)
- **Validation:** `parseExercisesRequestSchema`
- **Response:** `ParsedExercise[]` with confidence scores and category classification

**Request example:**

```json
{
  "text": "3 sets bench 225lbs x 8, then 3 miles in 24 min"
}
```

**Response example:**

```json
[
  {
    "exerciseName": "bench_press",
    "category": "strength",
    "confidence": 95,
    "missingFields": [],
    "sets": [
      { "setNumber": 1, "reps": 8, "weight": 225 },
      { "setNumber": 2, "reps": 8, "weight": 225 },
      { "setNumber": 3, "reps": 8, "weight": 225 }
    ]
  },
  {
    "exerciseName": "easy_run",
    "category": "running",
    "confidence": 80,
    "missingFields": [],
    "sets": [{ "setNumber": 1, "distance": 4828, "time": 24 }]
  }
]
```

### POST /api/v1/parse-workout-structure

Parse free text into a structured workout (blocks/structure) using the configured text AI provider.

- **Auth:** Required
- **Rate limit:** `parse` category, 5/min (shared budget with `parse-exercises`)
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** `{ text: string }` (1-2000 chars)
- **Validation:** `parseExercisesRequestSchema`
- **Response:** Parsed workout structure

### POST /api/v1/parse-exercises-from-image

Parse a photo of a workout plan (whiteboard, printout, screenshot) into structured exercise data using Gemini's multi-modal vision model. Images are expected to be compressed client-side via `client/src/lib/image.ts` (`compressImage`) before upload. A route-scoped `express.json({ limit: "10mb" })` parser handles the base64 body.

- **Auth:** Required
- **Rate limit:** `parse` category, 5/min (shared budget with text parsing)
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** `{ imageBase64: string, mimeType: "image/jpeg" | "image/png" | "image/webp" }`
- **Validation:** `parseExercisesFromImageRequestSchema` — enforces the mime-type enum, a 10MB cap on the base64 string, **and that the decoded leading bytes actually match the declared type** (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`). Without the byte check a mislabelled or non-image payload was billed for and forwarded to the vision model before anything noticed. A payload that is not valid base64 is rejected the same way. The client re-encodes every upload to JPEG through a canvas and strips the data-URL prefix, so real uploads are unaffected.
- **Response:** Same `ParsedExercise[]` shape as `/api/v1/parse-exercises`.

The same schema — and therefore the same byte check — guards every image route:
`/parse-workout-structure-from-image`, `/workouts/:id/reparse-from-image`,
`/plans/days/:dayId/reparse-from-image`, and the nutrition photo and label
parsers.

### POST /api/v1/parse-workout-structure-from-image

Photo sibling of `/parse-workout-structure` — parse a workout-structure photo into structured blocks.

- **Auth:** Required
- **Rate limit:** `parse` category, 5/min (shared budget)
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** `{ imageBase64, mimeType }`
- **Response:** Parsed workout structure

### POST /api/v1/workouts/:id/reparse-from-image

Re-parse an existing workout's exercises against a newly-uploaded photo. Used from the workout detail dialog when the coach updates the prescribed block or when the athlete captures the post-session whiteboard. Defined in `server/routes/workouts/workoutsAi.routes.ts`.

- **Auth:** Required (user must own the workout)
- **Rate limit:** `reparse` category, 5/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** `{ imageBase64, mimeType }` (same as above)
- **Response:** `{ exercises, saved: true, setCount, rejectedCount, rejectionReasons }`, or `422 PARSE_WRITE_THROUGH_REQUIRED` when no sets are persisted.

### POST /api/v1/chat

Send a message to the AI coach and receive a complete response.

- **Auth:** Required
- **Rate limit:** `chat` category, 10/min
- **Body:** `{ message: string (1-1000 chars), history?: ChatMessage[] }` — a longer history is accepted but only its last 20 messages are kept
- **Validation:** `chatRequestSchema`
- **Response:** `{ response: string, ragInfo: RagInfo }`

### POST /api/v1/chat/stream

Send a message to the AI coach and receive a streaming response via Server-Sent Events.

- **Auth:** Required
- **Rate limit:** `chat` category, 10/min
- **Body:** Same as `/api/v1/chat`, plus two plan-editing fields from `chatRequestSchema`: `planEditing?: boolean` (default `true`; `false` skips plan proposals) and `focusPlanDayId?: string` (max 255 — the plan day being viewed, passed to the proposal generator)
- **Plan editing:** when `planEditing` is on and the message is classified as a plan-change request, the reply is a [plan proposal](#plan-proposal-routes) instead of streamed prose; if the athlete has `coachAutoApplyPlanChanges` on, the stream tries to apply it immediately. Any failure in this branch falls back to the normal chat stream.
- **Response headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`
- **SSE events:**
  - `{ ragInfo: RagInfo }` — First event with RAG metadata
  - `{ planProposalPending: true }` — The message was classified as a plan-change request and a proposal is being generated
  - `{ text: string }` — Streaming text chunks (on the plan-editing path, a single chunk carrying the proposal summary)
  - `{ planProposal: { id, planId, status, summaryMessage, changes, createdAt } }` — The proposal that was created (`status: "applied"` when auto-applied)
  - `{ done: true }` — Stream complete
  - `{ error: "auth-expired" | "timeout", reason: string }` — The stream hit its deadline: the Clerk session's expiry (less a 5-second margin) or the 5-minute hard cap
  - `{ error: "Stream error" }` — Unexpected stream error

**Request example:**

```json
{
  "message": "How should I pace my sled push at competition?",
  "history": [
    { "role": "user", "content": "I have a Hyrox race in 6 weeks" },
    { "role": "assistant", "content": "Great! Let me help you prepare..." }
  ]
}
```

**SSE response sequence:**

```
data: {"ragInfo":{"source":"rag","chunkCount":3,"materialCount":2}}

data: {"text":"For the sled push, "}

data: {"text":"I recommend breaking it into "}

data: {"text":"three phases: an aggressive start, steady middle, and controlled finish."}

data: {"done":true}
```

If an error occurs mid-stream:

```
data: {"error":"Stream error"}
```

### GET /api/v1/chat/history

Retrieve saved chat messages for the current user, cursor-paginated.

- **Auth:** Required
- **Rate limit:** `chatHistory` category, 60/min
- **Query:** `limit?` (1-200), `before?` (ISO datetime), `beforeId?` (string) — `before` and `beforeId` must be supplied together
- **Response:** `ChatMessage[]` (plain array for backward compatibility). When more rows exist, the cursor for the next page is returned in the `X-Next-Cursor` (timestamp) and `X-Next-Cursor-Id` (row id) response headers, both of which must be echoed back on the next request.

### POST /api/v1/chat/message

Save a chat message to history.

- **Auth:** Required
- **Rate limit:** `chatMessage` category, 20/min
- **Body:** `{ role: "user" | "assistant", content: string (1-50000 chars) }`
- **Validation:** `insertChatMessageSchema` — `role` is an enum and `content` is length-bounded. The underlying column is a bare `varchar(20)`, so before these constraints any short string was accepted and later replayed into the model's context; the client legitimately persists both its own turn and the assistant reply it streamed, and nothing else. A `userId` in the body is ignored: the server always takes it from the session.
- **Response:** Saved `ChatMessage`

### DELETE /api/v1/chat/history

Clear all chat messages for the current user.

- **Auth:** Required
- **Rate limit:** `chatHistoryDelete` category, 5/min
- **Response:** `{ success: true }`

### GET /api/v1/coach-insights

Return the **last stored** Coach Insights analysis instantly, with no AI spend, so the Analytics tab paints the previous result on open instead of a blank state.

- **Auth:** Required
- **Rate limit:** `analytics` category, 60/min
- **AI gates:** None (read-only; never calls the model)
- **Response:** `{ ...CoachInsightsResult, generatedAt: string, stale: boolean }` — `stale` is `true` when a workout was logged after `generatedAt`. Returns `{ insights: null }` when the user has never generated insights.

### POST /api/v1/coach-insights

Regenerate the single-shot AI analysis of the athlete's progress against their stated goal and **persist** it to the durable `analytics_results` store. Generation lives in `services/coachInsightsService` so the route and the midnight [recompute job](integrations.md#job-types) share one path.

- **Auth:** Required
- **Rate limit:** `suggestions` category, 3/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Response:** `{ ...CoachInsightsResult, stale: false }` — freshly generated against the current latest workout, so never stale (`CoachInsightsResult` includes `insights` and `ragInfo`).

### GET /api/v1/overview-analysis

The last stored "what this means for you" reading for each Overview-tab chart, keyed so every chart card renders its own explanation inline. Same stored-first shape as Coach Insights: this GET paints the stored result instantly with no AI spend.

- **Auth:** Required
- **Rate limit:** `analytics` category, 60/min
- **Response:** the stored `OverviewAnalysisResult` plus `generatedAt` and a `stale` flag; `{ sections: null }` when nothing has been generated yet

### POST /api/v1/overview-analysis

Regenerate the Overview chart analysis and persist it. One AI call produces every chart's reading.

- **Auth:** Required
- **Rate limit:** `suggestions` category, 3/min — plus AI consent and budget checks
- **Response:** the fresh `OverviewAnalysisResult` with `stale: false` (it is generated against the current latest workout)

### POST /api/v1/timeline/ai-suggestions

Generate AI coaching suggestions for upcoming planned workouts.

- **Auth:** Required
- **Rate limit:** `suggestions` category, 3/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Response:** `{ suggestions: WorkoutSuggestion[], ragInfo: RagInfo }`
- **Note:** Returns empty suggestions if no upcoming planned workouts exist.

### POST /api/v1/timeline/ai-suggestions/apply

Apply a generated timeline AI suggestion to a plan day's field.

- **Auth:** Required
- **Rate limit:** `suggestionApply` category, 10/min
- **AI gates:** `aiConsentCheck`
- **Body:** `{ workoutId: string, targetField: "notes" | "mainWorkout" | "accessory", action: "replace" | "append", recommendation: string, rationale?: string | null, aiSource?: "rag" | "legacy" | "none" | null }`
- **Response:** The updated plan day (or 404 when the plan day is not found)

### GET /api/v1/timeline/ai-suggestions/debug/:workoutId

Inspect the AI suggestion trace and metadata for a plan day. Debugging aid.

- **Auth:** Required
- **Rate limit:** `aiSuggestionsDebug` category, 30/min
- **Response:** `{ workoutId, focus, aiSource, aiRationale, aiNoteUpdatedAt, trace, debugSummary }` (or 404)

---

## Coaching Material Routes

**File:** `server/routes/coaching.ts`

### GET /api/v1/coaching-materials

List all coaching materials for the current user.

- **Auth:** Required
- **Response:** `CoachingMaterial[]`

### POST /api/v1/coaching-materials

Create a new coaching material. Triggers background embedding via pg-boss queue.

- **Auth:** Required
- **Rate limit:** `coaching` category, 10/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body limit:** 2MB (elevated from default 100kb)
- **Body:** `{ title: string (1-255 chars), content: string (1-1,500,000 chars), type: "principles" | "document" }`
- **Validation:** `createMaterialSchema` (`insertCoachingMaterialSchema` without `userId`)
- **Side effects:** Queues `embed-coaching-material` job for RAG chunking/embedding.
- **Response:** `201` Created `CoachingMaterial`

### PATCH /api/v1/coaching-materials/:id

Update a coaching material. Re-embeds if content or title changed.

- **Auth:** Required
- **Rate limit:** `coaching` category, 10/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Body:** Partial `{ title?, content?, type? }`
- **Side effects:** Queues re-embedding if content or title changed.
- **Response:** Updated `CoachingMaterial`

### DELETE /api/v1/coaching-materials/:id

Delete a coaching material, then purge its RAG chunks (`deleteChunksByMaterialId`) and clear the user's retrieval cache. The FK cascade only covers single-DB mode — with `VECTOR_DATABASE_URL` set (as in production) `document_chunks` lives in a separate Postgres with no FKs — so the purge is best-effort: a failure is logged and the daily `ragChunkPrune` cron (03:50 UTC) sweeps the orphans.

- **Auth:** Required
- **Rate limit:** `coaching` category, 10/min
- **Response:** `{ success: true }`

### GET /api/v1/coaching-materials/rag-status

Check the RAG pipeline status (embedding counts, dimension info).

- **Auth:** Required
- **Response:** RAG status object

### POST /api/v1/coaching-materials/re-embed

Re-embed all coaching materials for the current user.

- **Auth:** Required
- **Rate limit:** `coaching` category, 5/min
- **AI gates:** `aiConsentCheck`, `aiBudgetCheck`
- **Response:** Re-embed result summary

---

## Plan Proposal Routes

When a coach-chat message reads as a plan-change request, [`POST /api/v1/chat/stream`](#post-apiv1chatstream) raises a proposal (`createPlanAdjustmentProposal` in `server/services/planAdjustmentService.ts`) rather than rewriting the plan silently; these routes are how the athlete accepts or declines it. With `coachAutoApplyPlanChanges` on, the stream tries to apply it straight away. The background auto-coach (`server/services/coachService.ts`) raises no proposals — it writes its plan-day adjustments directly. **File:** `server/routes/planProposals.ts`.

### GET /api/v1/plan-proposals/pending

The athlete's currently pending proposal, if any.

- **Auth:** Required
- **Rate limit:** `analytics` category, 60/min
- **Response:** `{ proposal: { id, planId, status, summaryMessage, changes, createdAt } | null }`

### POST /api/v1/plan-proposals/:id/apply

Apply the proposed changes to the plan.

- **Auth:** Required
- **Rate limit:** `suggestionApply` category, 10/min — requires AI consent. The AI budget is deliberately _not_ checked up front: it is checked internally only if a structured re-parse actually turns out to be needed.
- **Errors:** `404` (proposal not found), `409` (`not_pending` or `stale` — the plan moved on underneath it)

### POST /api/v1/plan-proposals/:id/dismiss

Decline the proposal and leave the plan untouched.

- **Auth:** Required
- **Rate limit:** `suggestionApply` category, 10/min
- **Errors:** `404` (proposal not found)

---

## Consent Routes

An auditable server-side record of consent decisions (W4). The privacy banner and the Sentry opt-in still write `localStorage` for the fast client-side gate, but authenticated users also get a durable record, so consent is demonstrable (GDPR Art. 7) and an opt-out is on file (CCPA). **File:** `server/routes/consent.ts`.

### POST /api/v1/consents

Record a consent decision.

- **Auth:** Required
- **Rate limit:** `consent` category, 20/min
- **Body:** `{ consentType, granted }` (`recordConsentSchema`); stored as `{ userId, consentType, granted, consentedAt }`
- **Response:** `{ success: true }`

### GET /api/v1/consents

The user's recorded consent decisions — the read behind a DSAR.

- **Auth:** Required
- **Rate limit:** `consent` category, 30/min
- **Response:** `{ consents }`

---

## Preferences Routes

**File:** `server/routes/preferences.ts`

### GET /api/v1/preferences

Get the current user's preferences.

- **Auth:** Required
- **Rate limit:** `preferencesRead` category, 60/min
- **Response:** Serialized preferences — `{ weightUnit, distanceUnit, userTimezone, weeklyGoal, mealSchedule, emailNotifications, emailWeeklySummary, emailMissedReminder, emailWeeklyReviewReminder, emailTodaySession, emailAnalysisDigest, notifyHour, notifyHourWeeklySummary, notifyHourMissedReminder, notifyHourWeeklyReviewReminder, notifyHourTodaySession, notifyHourAnalysisDigest, showAdherenceInsights, aiCoachEnabled, coachAutoApplyPlanChanges, trainingStyleId, trainingStylePreviousId, trainingStyleChangedAt, trainingStyleRecomputeNow, onboardingCompleted, division, gender, age, bodyweightKg, heightCm, restingHr, maxHr, ftp, activityLevel, weightGoalDirection, weightGoalRateKgPerWeek, mafAge, mafInjuryIllnessMedication, mafConsistency, mafTrend, mafCategory, mafHrDataAvailable, mafHr, mafBaselineTestScheduledAt }` (an unset per-email `notifyHour*` override stays `null`, meaning that email follows the default send time) plus two derived fields: `planWeeklyDensity` (the active plan's per-week density — a real number to 2 dp, e.g. `2.5` for a 10-day plan over 4 weeks — or `null`) and `weeklyGoalExceedsPlan` (boolean hint when the user's `weeklyGoal` exceeds that density).

### PATCH /api/v1/preferences

Update user preferences.

- **Auth:** Required
- **Rate limit:** `preferences` category, 20/min
- **Body:** Partial of the serialized preference fields above (e.g. `weightUnit?: "kg" | "lbs"`, `distanceUnit?: "km" | "miles"`, `userTimezone?` (IANA name), `weeklyGoal?` (1-14), `mealSchedule?: 3 | 4 | 5`, the `email*` toggles, `notifyHour?` (0-23) and the per-email `notifyHour*` overrides (0-23, or `null` to clear), `aiCoachEnabled?`, `coachAutoApplyPlanChanges?`, `showAdherenceInsights?`, `onboardingCompleted?`, `trainingStyleId?`, the profile fields `division` … `weightGoalRateKgPerWeek`, and the `maf*` fields). Also accepts three fields the response does not echo: `pushRefuelReminder?`, `pushLoggingReminder?` and `trainingConstraints?` (max 500 chars).
- **Validation:** `updateUserPreferencesSchema`
- **Timezone validation:** a `userTimezone` the server runtime does not recognise returns `400 { code: "INVALID_TIMEZONE" }`.
- **MAF validation:** Switching `trainingStyleId` to `maf_method` requires `mafAge` plus either `mafCategory`, or the legacy `mafConsistency`/`mafTrend` pair, to be set (in the body or already persisted); otherwise the route returns `400 { code: "MAF_SETUP_REQUIRED" }`.
- **Response:** Updated serialized preferences object (without the two derived fields)
- **Email toggle semantics:** `emailNotifications` is the master switch — when `false`, no email is sent regardless of the per-type flags. `emailWeeklySummary`, `emailMissedReminder`, `emailWeeklyReviewReminder`, `emailTodaySession` and `emailAnalysisDigest` gate the individual categories and take effect only when the master is on. All six default to `false` at the database level for new users (GDPR-compliant opt-in).
- **Auto-apply semantics:** `coachAutoApplyPlanChanges` (default `false`) makes the coach chat try to apply its [plan proposals](#plan-proposal-routes) as soon as they are raised instead of waiting for an explicit apply.
- **AI consent semantics:** `aiCoachEnabled` gates every outbound AI provider call (workout parsing, chat, auto-coach, embeddings, and image parsing). It defaults to `false` for new users; the AI features are hidden or disabled in the UI until the user explicitly opts in. Flipping it to `false` immediately stops new AI requests; already-persisted chat history and plan AI artifacts remain until the user deletes them.
- **Onboarding completion:** `onboardingCompleted` stores whether the welcome flow has finished across devices. It is app state, not a visible Settings preference.

---

## Email Routes

**File:** `server/routes/email.ts`

### POST /api/v1/emails/check

Manually trigger email checks for the current user (weekly summary, missed reminders).

- **Auth:** Required (Clerk JWT)
- **Rate limit:** `emailCheck` category, 5/min
- **Response:** `{ sent: string[] }` — list of email types sent

### GET /api/v1/cron/emails

External cron trigger endpoint for batch email processing across all users.

- **Auth:** `x-cron-secret` header (timing-safe comparison with `CRON_SECRET` env var)
- **No Clerk auth required**
- **Rate limit:** `cronEmails` category, 10/min
- **Response:** Cron job result summary
- **Note:** The scan gates per athlete on each email's own local send hour (its override, else their default `notifyHour`), so an external scheduler should call this hourly.

### GET /api/v1/emails/unsubscribe

**File:** `server/routes/emailUnsubscribe.ts`. Confirm page for the unsubscribe link every email carries in its footer and `List-Unsubscribe` header. Side-effect free — link scanners prefetch email URLs.

- **Auth:** `token` query parameter (HMAC-signed athlete id; see `server/emailUnsubscribeToken.ts`). No Clerk auth, no CSRF token — mounted ahead of the CSRF guard.
- **Rate limit:** `emailUnsubscribe` category, 60 per 15 min
- **Response:** `200` HTML confirm page with a form posting to the same URL; `400` HTML "link no longer valid" page for a bad token

### POST /api/v1/emails/unsubscribe

Turns the master `emailNotifications` toggle off for the athlete the token names. Handles both the RFC 8058 one-click POST from mail clients (body `List-Unsubscribe=One-Click`) and the confirm page's form.

- **Auth:** `token` query parameter, as above
- **Rate limit:** `emailUnsubscribe` category, 60 per 15 min
- **Response:** `200` HTML "you're unsubscribed" (or a graceful `200` when the account no longer exists); `400` for a bad token

---

### GET /api/v1/analytics/internal/structured-exercise-health

Internal structured exercise health rollup endpoint. Defined in `server/routes/analytics.ts`.

- **Auth:** Clerk auth plus `x-internal-analytics-secret` header (timing-safe comparison with `INTERNAL_ANALYTICS_SECRET` env var)
- **Rate limit:** `internalAnalytics` category, 5/min
- **Response:** `{ rollups, counters }`

---

## Push Notification Routes

**File:** `server/routes/push.ts`

Web Push (VAPID) endpoints used by the PWA to deliver missed-workout nudges and weekly summary notifications. Push counts as configured only when `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_EMAIL` are all set (`isPushEnabled()` in `server/pushNotifications.ts`). Only `GET /api/v1/push/vapid-key` checks this up front; the other routes still run, and `POST /api/v1/push/test` then reports `sent: 0`.

### GET /api/v1/push/vapid-key

Return the server's VAPID public key so the client can call `PushManager.subscribe`.

- **Auth:** Required
- **Rate limit:** `push` category, 60/min
- **Response:** `{ publicKey: string }`
- **Errors:** `404 PUSH_NOT_CONFIGURED` when push is not configured

### POST /api/v1/push/subscribe

Persist a `PushSubscription` for the authenticated user. Multiple endpoints per user are allowed (one per device), capped at **10**; past that the oldest rows are evicted rather than the new registration refused, so replacing devices never locks an athlete out of notifications.

- **Auth:** Required
- **Rate limit:** `push` category, 10/min
- **Body:** `{ endpoint: string, keys: { p256dh: string, auth: string } }` — `endpoint` must be HTTPS and must pass the [SSRF guard](../server/ssrfGuard.ts), since the server later POSTs to it
- **Response:** `{ success: true }`

The cap matters because each row is an arbitrary URL the server will send requests
to: an unbounded list would turn `POST /api/v1/push/test` into a way to fan out
requests to many third-party hosts. See `MAX_PUSH_SUBSCRIPTIONS_PER_USER` in
`server/storage/push.ts`.

### DELETE /api/v1/push/unsubscribe

Remove a specific subscription endpoint for the authenticated user.

- **Auth:** Required
- **Rate limit:** `push` category, 10/min
- **Body:** `{ endpoint: string }`
- **Response:** `{ success: true }`

### POST /api/v1/push/test

Dispatch a test notification to every registered subscription for the authenticated user. Used by the Settings UI to verify the PWA install is wired up correctly.

- **Auth:** Required
- **Rate limit:** `push` category, 5/min
- **Response:** `{ success: true, sent: number }`

---

## Strava Routes

**File:** `server/strava.ts`

### GET /api/v1/strava/status

Check if the current user has a Strava connection.

- **Auth:** Required
- **Rate limit:** `stravaStatus` category, 60 per 15 minutes
- **Response:** `{ connected: boolean, athleteId?: string, lastSyncedAt?: string, requiresReauth?: boolean, autoSync: { enabled: boolean, webhook: boolean, intervalMinutes: number } }` — `requiresReauth: true` means Strava rejected our stored credentials (the user revoked the app on strava.com); the client should offer a Reconnect flow. `autoSync` describes how the deployment keeps Strava current without the Sync button (see [Integrations → Automatic Sync](integrations.md#automatic-sync)): `webhook` is true once the push subscription is verified, otherwise the polling fallback runs every `intervalMinutes`.

### GET /api/v1/strava/auth

Generate a Strava OAuth authorization URL with CSRF-protected signed state.

- **Auth:** Required
- **Rate limit:** `stravaAuth` category, 20 per 15 minutes, per user (the limiter runs after `isAuthenticated`; the bucket is shared with `/callback`)
- **Response:** `{ url: string }` — Redirect URL for Strava OAuth
- **State parameter:** HMAC-SHA256 signed with `userId:timestamp:nonce:signature`, max age enforced, single-use (atomically claimed on callback)

### GET /api/v1/strava/callback

OAuth callback handler. Exchanges authorization code for tokens, encrypts and stores them.

- **Auth:** Not required (redirect from Strava)
- **Rate limit:** `stravaAuth` category, 20 per 15 minutes (shared with `/auth`) — keyed by userId when the request carries a Clerk session, otherwise by IP
- **Query:** `code`, `state` (CSRF-verified, single-use — replays redirect to `/settings?strava=error`), `scope`
- **Side effects:** Creates `stravaConnections` record with AES-256-GCM encrypted tokens; clears any `requires_reauth` tombstone on reconnect
- **Response:** Redirect to `/settings`

### POST /api/v1/strava/sync

Incrementally sync Strava activities into workout logs (since `lastSyncedAt` with a 7-day overlap; 90-day backfill on first sync; up to 5 × 200-activity pages per call). Runs the same `syncStravaForUser()` engine as the background [automatic sync](integrations.md#automatic-sync); the button remains for an on-demand refresh.

- **Auth:** Required
- **Rate limit:** `stravaSync` category, 5 per 15 minutes, per user
- **Side effects:** Fetches activities from Strava API, maps to WorkoutLog format, deduplicates by `stravaActivityId`, auto-refreshes expired tokens (serialized under a per-user advisory lock), enriches calories for the newest ≤25 imports from the activity-detail endpoint, then reconciles each new activity against that day's logged workouts and open plan days — attaching the recording to the workout the athlete already logged (filling only NULL metrics), completing the open plan day with a log built like a manual confirm, or importing standalone (with a suggested match when one was plausible but not certain; see [Integrations → Activity Sync](integrations.md#activity-sync)) — and advances the `lastSyncedAt` cursor.
- **Response:** `{ success: true, imported: number, enriched: number, completedPlanDays: number, suggested: number, standalone: number, skipped: number, total: number, hasMore: boolean }` — `imported` is the sum of the four landing counts; `hasMore: true` means the page cap was hit and another sync will continue where this one stopped.
- **Errors:** `401 { code: "STRAVA_REAUTH_REQUIRED" }` (revoked — reconnect needed), `401 { code: "UNAUTHORIZED" }` (not connected), `429 { code: "RATE_LIMITED", retryAfterSeconds }` (Strava rate limit, after retries), `502 { code: "EXTERNAL_API_ERROR" }` (transient upstream failure).

### DELETE /api/v1/strava/disconnect

Disconnect the Strava integration. Performs a best-effort upstream `POST /oauth/deauthorize` (non-fatal on failure) before deleting the local connection.

- **Auth:** Required
- **Rate limit:** `stravaDisconnect` category, 10 per 15 minutes
- **Response:** `{ success: true }`

---

### GET /api/v1/strava/webhook

Strava's subscription-validation challenge, sent once (synchronously) while the server registers its push subscription.

- **Auth:** Not required (the request comes from Strava)
- **Rate limit:** IP-based, 300 per minute (shared with the POST below)
- **Query:** `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`
- **Response:** `200 { "hub.challenge": string }` when `hub.verify_token` matches this deployment's token (`STRAVA_WEBHOOK_VERIFY_TOKEN`, or the value derived from `STRAVA_CLIENT_SECRET`); `403` otherwise

### POST /api/v1/strava/webhook

Strava webhook event receiver — the push half of [automatic sync](integrations.md#automatic-sync). Mounted ahead of the CSRF guard because Strava's deliveries carry neither cookie nor token.

- **Auth:** Not required and unsigned — the payload is treated as a hint only. An event never writes anything itself: it enqueues a debounced `strava-sync` job for the connected account(s) behind `owner_id`, and that job fetches from Strava with the athlete's own token and dedups like any other sync.
- **Rate limit:** IP-based, 300 per minute
- **Body:** `{ object_type: "activity" | "athlete", object_id: number, aspect_type: "create" | "update" | "delete", owner_id: number, subscription_id: number, event_time?: number, updates?: object }`
- **Response:** `200 { received: true }` immediately, for well-formed and malformed bodies alike (Strava retries non-2xx responses up to three times). Processing happens after the acknowledgement: `delete` events, unknown athletes, tombstoned connections and events for a `subscription_id` other than the verified one are ignored; an athlete deauthorization enqueues a sync whose 401 handling tombstones the connection.

## Garmin Routes

**File:** `server/garmin.ts`

Garmin Connect sync uses a reverse-engineered SSO flow (email + password), not a public OAuth application. See [Integrations → Garmin Connect](integrations.md#garmin-connect-integration) for the rationale, safety stack, and storage model.

All mutating routes apply `protectedMutationGuards` (auth + idempotency; CSRF is enforced globally, as for every mutation). `POST /connect` and `POST /sync` short-circuit with HTTP 503 `GARMIN_CIRCUIT_OPEN` while the global 429 circuit breaker is tripped (30 minutes after any Garmin 429); `/status` and `/disconnect` do not check it. A trip is persisted to `server_runtime_cache` under `garmin:breaker`, and every instance re-reads it before each Garmin API call, so a 429 seen by one instance freezes them all.

### GET /api/v1/garmin/status

Returns the Garmin connection state for the authenticated user.

- **Auth:** Required
- **Rate limit:** `garmin-status` category, 60 per 15 minutes
- **Response:** `{ connected: false }` or `{ connected: true, garminDisplayName: string | null, lastSyncedAt: string | null, lastError: string | null }`

### POST /api/v1/garmin/connect

Authenticate with Garmin using email + password and persist the encrypted credentials / OAuth tokens.

- **Auth:** Required
- **Rate limit:** `garmin-connect` category, 5 per 15-minute window per user
- **Body:** `{ email: string (valid email, max 254), password: string (1-256) }`
- **Behavior:** Logs into Garmin _before_ writing any DB row — nothing is stored on failure. Fetches `getUserProfile()` to capture the display name (optional; non-fatal if it fails).
- **Responses:**
  - `200 { success: true, garminDisplayName: string | null }`
  - `400 { code: "VALIDATION_ERROR" }` — invalid email / empty password (`validateBody`)
  - `401 { code: "GARMIN_AUTH_FAILED" }` — invalid credentials or 2SV enabled (see error translation in `server/garmin.ts`)
  - `409 { code: "GARMIN_BUSY" }` — another Garmin op for the same user is in progress (per-user mutex)
  - `503 { code: "GARMIN_CIRCUIT_OPEN" }` — global 429 breaker is tripped

### DELETE /api/v1/garmin/disconnect

Removes the `garmin_connections` row for the user (credentials, tokens, display name).

- **Auth:** Required
- **Rate limit:** `garmin-disconnect` category, 10 per 15 minutes
- **Response:** `{ success: true }`

### POST /api/v1/garmin/sync

Imports the most recent activities from Garmin into `workout_logs`.

- **Auth:** Required
- **Rate limit:** `garmin-sync` category, 5 per 15-minute window per user
- **Preflight rejections (checked before login):**
  - `404 { code: "GARMIN_NOT_CONNECTED" }`
  - `429 { code: "GARMIN_SYNC_TOO_SOON" }` — less than 5 minutes since `lastSyncedAt`
  - `401 { code: "GARMIN_RECONNECT_REQUIRED" }` — prior `lastError` is set; user must disconnect + reconnect
  - `503 { code: "GARMIN_CIRCUIT_OPEN" }` — global 429 breaker tripped
- **Behavior:** Calls `client.getActivities(0, 20)`, dedupes against the partial unique index `(user_id, garmin_activity_id) WHERE garmin_activity_id IS NOT NULL`, and inserts the new rows via `onConflictDoNothing`.
- **Success response:** `{ success: true, imported: number, skipped: number, total: number }` — `imported` is the true insert count; anything caught by the partial index is rolled into `skipped`.
- **Error responses:** `401 GARMIN_AUTH_FAILED`, `502 GARMIN_API_ERROR` (with `lastError` persisted), `409 GARMIN_BUSY`.

---

## Timeline and Export Routes

**Files:** `server/routes/workouts/workoutsTimeline.routes.ts`, `server/routes/workouts/workoutsExport.routes.ts`, and the exercise-history route in `server/routes/workouts/workoutsCrud.routes.ts`.

### GET /api/v1/timeline

Get merged timeline of planned and logged workouts.

- **Auth:** Required
- **Rate limit:** `timeline` category, 60/min
- **Query:** `planId?` (filter by plan), `limit?` (past entries per page, default 200, max 500), `before?` (`YYYY-MM-DD`, exclusive: the previous page's cursor), `offset?` (legacy flat window; no cursor is returned when it is sent)
- **Response:** `TimelineEntry[]` — merged planned + logged workouts sorted by date, newest first
- **Headers:** `X-Next-Cursor: YYYY-MM-DD` when older entries exist; echo it back as `before` for the next page

The first page (no `before`) is anchored on the athlete's today: it holds every entry dated today or later plus the most recent `limit` past entries, so the upcoming schedule is always complete. Pages never split a calendar date.

Plan-day entries also carry `priority` (the session's tier, absent on rest days), `recovery` and `missedOn` (what became of a missed session — see [missed-session recovery](#get-apiv1plansdaysdayidrecovery)), `recoverable` (`true` on a missed session the timeline should ask about: undecided, a real session, not a race-week day, before its plan was retired, and missed no more than seven days ago in the athlete's timezone) and `raceDerived` (`true` when the session shown is the race, the shakeout before it or recovery after it, set by the plan's race date). Each is omitted when it doesn't apply.

**Response example:**

```json
[
  {
    "id": "pd_101",
    "date": "2025-03-17",
    "type": "planned",
    "status": "planned",
    "focus": "Sled Push + SkiErg",
    "mainWorkout": "4x50m sled push at 100kg, 3x500m SkiErg",
    "accessory": "3x15 wall balls",
    "notes": null,
    "planDayId": "pd_101",
    "workoutLogId": null,
    "weekNumber": 3,
    "dayName": "Monday",
    "planName": "Hyrox 8-Week Prep",
    "planId": "plan_abc"
  },
  {
    "id": "wl_202",
    "date": "2025-03-16",
    "type": "logged",
    "status": "completed",
    "focus": "Easy Run",
    "mainWorkout": "5km easy run",
    "accessory": null,
    "notes": "Felt good, kept HR under 145",
    "duration": 30,
    "rpe": 4,
    "planDayId": null,
    "workoutLogId": "wl_202",
    "source": "strava",
    "exerciseSets": [
      {
        "id": "es_501",
        "workoutLogId": "wl_202",
        "exerciseName": "easy_run",
        "category": "running",
        "setNumber": 1,
        "distance": 5000,
        "time": 30,
        "reps": null,
        "weight": null
      }
    ],
    "calories": 320,
    "distanceMeters": 5000,
    "avgHeartrate": 142,
    "maxHeartrate": 155
  }
]
```

### GET /api/v1/exercises/:exerciseName/history

Get historical exercise sets for a specific exercise, newest session first.

The name is resolved through `normalizeExerciseName`, so `RDL` finds
`romanian_deadlift`; names it can't resolve fall back to an exact match.

- **Auth:** Required
- **Rate limit:** `exerciseHistory` category, 120/min — the client fires one
  request per distinct exercise when a session is opened, so this has its own
  bucket rather than sharing `workoutHistory`
- **Query:** `sessions` (1–20, optional) — bounds the number of distinct
  training **dates** returned, not the number of rows, so a session's sets are
  never returned in part
- **Response:** Exercise set history with dates

### GET /api/v1/export

Export all training data as CSV or JSON.

- **Auth:** Required
- **Rate limit:** `export` category, 5/min
- **Query:** `format` — `"csv"` (default) or `"json"`
- **Response:** File download with appropriate Content-Type and Content-Disposition headers. Records sitting in the [recycle bin](#recycle-bin-routes) are not included.

---

## Nutrition Routes

**Base path:** `/api/v1/nutrition` (paths in the table are relative to it). **Files:** `server/routes/nutrition/*`.

The entire nutrition surface is gated by the `NUTRITION_ENABLED` server flag — when it is not `"true"`, every route below returns `404`. The AI-backed routes (`/parse/*`, `POST /insights`) additionally require AI consent and budget. These routes are **not yet registered with the OpenAPI registry**, so they are absent from [`docs/openapi.json`](openapi.json) and Swagger UI; this catalog and [Nutrition & Fuelling § API surface](nutrition.md#5-api-surface) are the reference until they are migrated.

| Method | Path                                   | Purpose                                                                                                          | Rate limit (per min)                 |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| GET    | `/foods/search`                        | Search local cache + Edamam + USDA + Open Food Facts (fuzzy / synonym / optional semantic)                       | `nutritionSearch` (30)               |
| GET    | `/foods/recent`                        | Recently logged foods (`FoodWithPortionMemory[]` — each food plus its `lastQuantityG` / `lastMealType`)          | `nutritionRead` (60)                 |
| GET    | `/foods/custom`                        | The user's custom foods                                                                                          | `nutritionRead` (60)                 |
| POST   | `/foods/barcode`                       | Barcode → food (Open Food Facts)                                                                                 | `nutritionBarcode` (30)              |
| POST   | `/foods`                               | Create a custom food (+ servings)                                                                                | `nutritionWrite` (30)                |
| GET    | `/foods/:id`                           | Food + named servings                                                                                            | `nutritionRead` (60)                 |
| PATCH  | `/foods/:id`                           | Edit a custom food                                                                                               | `nutritionWrite` (30)                |
| DELETE | `/foods/:id`                           | Delete a custom food (`409` if referenced by a log)                                                              | `nutritionWrite` (30)                |
| POST   | `/foods/:id/servings`                  | Add a named serving                                                                                              | `nutritionWrite` (30)                |
| DELETE | `/foods/:id/servings/:servingId`       | Delete a serving                                                                                                 | `nutritionWrite` (30)                |
| GET    | `/favorites`                           | List favourites (`FoodWithPortionMemory[]` — each food plus its `lastQuantityG` / `lastMealType`)                | `nutritionRead` (60)                 |
| POST   | `/favorites`                           | Add a favourite                                                                                                  | `nutritionFav` (30)                  |
| DELETE | `/favorites/:foodId`                   | Remove a favourite                                                                                               | `nutritionFav` (30)                  |
| POST   | `/logs`                                | Log a food                                                                                                       | `nutritionLog` (60)                  |
| PATCH  | `/logs/:id`                            | Edit a log entry                                                                                                 | `nutritionLog` (60)                  |
| DELETE | `/logs/:id`                            | Delete a log entry                                                                                               | `nutritionLog` (60)                  |
| POST   | `/logs/repeat`                         | Repeat a day / meal                                                                                              | `nutritionLog` (20)                  |
| POST   | `/logs/batch`                          | Confirm reviewed parsed items                                                                                    | `nutritionLog` (60)                  |
| GET    | `/summary`                             | Daily totals + per-meal breakdown, incl. `mealTargets`                                                           | `nutritionRead` (60)                 |
| GET    | `/summary-range`                       | Batched daily totals for a date window (one read, no per-day fan-out)                                            | `nutritionRead` (60)                 |
| GET    | `/session-fuelling/:workoutId`         | Pre/post-session fuelling windows                                                                                | `nutritionRead` (60)                 |
| GET    | `/planned-session-estimate/:planDayId` | Fuelling estimate for a session that hasn't happened yet                                                         | `nutritionRead` (60)                 |
| GET    | `/block`                               | Daily intake macros vs. training UTSS                                                                            | `nutritionRead` (60)                 |
| GET    | `/targets`                             | Current target + history                                                                                         | `nutritionRead` (60)                 |
| POST   | `/targets`                             | Set / replace the target version                                                                                 | `nutritionWrite` (30)                |
| GET    | `/micros`                              | The day's micronutrients vs. RDI                                                                                 | `nutritionRead` (60)                 |
| POST   | `/meal-targets`                        | Set / replace a per-meal target                                                                                  | `nutritionWrite` (30)                |
| DELETE | `/meal-targets/:mealType`              | Clear a per-meal target                                                                                          | `nutritionWrite` (30)                |
| POST   | `/parse/text`                          | Natural-language meal → items **(AI)**                                                                           | `parse` (5) + consent + budget       |
| POST   | `/parse/photo`                         | Photo → items **(AI)**                                                                                           | `parse` (5) + consent + budget       |
| POST   | `/parse/label`                         | Nutrition-label photo → a single food, transcribed rather than estimated; `label: null` when unreadable **(AI)** | `parse` (5) + consent + budget       |
| GET    | `/insights`                            | Last stored AI nutrition analysis                                                                                | `nutritionRead` (60)                 |
| POST   | `/insights`                            | Regenerate the analysis **(AI)**                                                                                 | `suggestions` (3) + consent + budget |
| GET    | `/recipes`                             | List recipes                                                                                                     | `nutritionRead` (60)                 |
| POST   | `/recipes`                             | Create a recipe                                                                                                  | `nutritionWrite` (30)                |
| GET    | `/recipes/:id`                         | Recipe + ingredients + per-serving macros                                                                        | `nutritionRead` (60)                 |
| PATCH  | `/recipes/:id`                         | Edit a recipe                                                                                                    | `nutritionWrite` (30)                |
| DELETE | `/recipes/:id`                         | Delete a recipe                                                                                                  | `nutritionWrite` (30)                |

`/planned-session-estimate/:planDayId` is intentionally **not** an AI route: its
deterministic and pace-personalized layers must work for every athlete, so it
carries no `aiConsentCheck` middleware. The optional AI refinement on top is
gated inline instead — it is skipped unless `users.aiCoachEnabled` is true, and
the consent flag is part of the result's cache key so opting out immediately
stops a previously refined value being replayed. The same inline pattern is used
by nutrition semantic search.

See [Nutrition & Fuelling](nutrition.md) for request/response shapes, the per-100g scaling model, and AI safety details.

---

## See Also

- [AI and RAG](ai-and-rag.md) -- Architecture of the RAG pipeline, embedding strategy, and coaching material processing.
- [Authentication](authentication.md) -- Clerk JWT setup, middleware configuration, and session management.
- [Nutrition & Fuelling](nutrition.md) -- The full nutrition subsystem: data model, food search, fuelling, and AI usage.
