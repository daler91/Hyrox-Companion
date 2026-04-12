# API Reference

[Back to README](../README.md)

## Overview

The Hyrox Companion exposes a RESTful API under the `/api/v1/` prefix. All endpoints (except the health check and cron trigger) require Clerk JWT authentication. Request bodies are validated with Zod schemas, and rate limiting is applied per-user per-category.

**Base URL:** `/api/v1`
**Content-Type:** `application/json` (requests and responses)
**Authentication:** Clerk JWT via `credentials: "include"` (cookie-based)

---

## Table of Contents

- [Error Responses](#error-responses)
- [Rate Limiting](#rate-limiting)
- [CSRF Protection](#csrf-protection)
- [Idempotency](#idempotency)
- [Request Validation](#request-validation)
- [Auth Routes](#auth-routes)
- [Account Routes](#account-routes)
- [Workout Routes](#workout-routes)
- [Custom Exercise Routes](#custom-exercise-routes)
- [Training Plan Routes](#training-plan-routes)
- [Timeline Annotation Routes](#timeline-annotation-routes)
- [Analytics Routes](#analytics-routes)
- [AI and Chat Routes](#ai-and-chat-routes)
- [Coaching Material Routes](#coaching-material-routes)
- [Preferences Routes](#preferences-routes)
- [Email Routes](#email-routes)
- [Strava Routes](#strava-routes)
- [Garmin Routes](#garmin-routes)
- [Timeline and Export Routes](#timeline-and-export-routes)

---

## Error Responses

All errors follow a standard format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": { "issues": [{ "path": "field", "message": "..." }] }
}
```

- `details` is only included for validation errors and non-500 responses.
- 500 errors always return `"Internal Server Error"` to prevent leaking internals.

**Validation error example (400):**

```json
{
  "error": "Invalid workout data",
  "code": "VALIDATION_ERROR",
  "details": {
    "issues": [
      { "path": "date", "message": "Must be a valid date in YYYY-MM-DD format" },
      { "path": "rpe", "message": "Number must be less than or equal to 10" },
      { "path": "exercises[0].exerciseName", "message": "String must contain at least 1 character(s)" }
    ]
  }
}
```

**Rate limit error example (429):**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 1710500045
```

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMITED"
}
```

**Not found error example (404):**

```json
{
  "error": "Workout not found",
  "code": "NOT_FOUND"
}
```

**Common HTTP status codes:**

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_CSV` | Invalid input |
| 401 | `UNAUTHORIZED` | Missing or invalid auth |
| 404 | `NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMITED` | Rate limit exceeded (includes `Retry-After` header) |
| 500 | `INTERNAL_SERVER_ERROR` | Server error |

---

## Rate Limiting

Rate limits are applied per-user (keyed by Clerk userId) and namespaced by category so limits are independent across route groups.

- **Default window:** 60 seconds
- **Strava routes:** 15-minute window
- **Response on limit:** `429` with `Retry-After` header and `RATE_LIMITED` code
- **Headers:** Standard `RateLimit-*` headers (RFC 6585)

Implementation: `server/routeUtils.ts` — `rateLimiter(category, maxRequests, windowMs)`

---

## CSRF Protection

All mutating endpoints (POST/PUT/PATCH/DELETE) require a valid CSRF token. The token is obtained via:

### GET /api/v1/csrf-token

Retrieve a CSRF token for use in subsequent mutating requests.

- **Auth:** Not strictly required (works pre-login, bound to IP; after login, bound to userId)
- **Response:** `{ token: string }`
- **Side effects:** Sets a signed `__Host-hyrox.x-csrf` cookie (production) or `hyrox.x-csrf` (development)

The returned token must be sent as the `x-csrf-token` header on all mutating requests. Missing or invalid tokens result in a `403 Forbidden` response.

---

## Idempotency

Mutating endpoints support the `X-Idempotency-Key` header for safe request replay.

- **Header:** `X-Idempotency-Key` (optional, max 255 characters)
- **Behavior:** When present on a mutating request (POST/PUT/PATCH/DELETE), the server caches the response for 24 hours keyed by `(userId, key)`. Repeat requests with the same key return the cached response without re-executing the handler.
- **Use case:** The client's offline queue sends this header when replaying mutations that were queued while offline, preventing duplicate state changes.

---

## Request Validation

Endpoints use Zod schemas for request body validation via two patterns:

1. **`validateBody(schema)` middleware** — Parses `req.body` with the schema, returns 400 on failure, replaces `req.body` with parsed data on success.
2. **Inline `safeParse()`** — Used in routes that need custom error messages or partial validation.

Validation errors return:

```json
{
  "error": "First validation error message",
  "code": "VALIDATION_ERROR",
  "details": {
    "issues": [
      { "path": "field.nested", "message": "Must be at least 1" }
    ]
  }
}
```

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
- **Side effects, in order:**
  1. **Clerk identity is deleted first.** If Clerk returns HTTP 404, the identity is treated as already-deleted (idempotent retry); any other error aborts the request so the DB row is not orphaned. Without this ordering, `ensureUserExists` on the next authenticated request would silently re-provision the account.
  2. **Best-effort Strava deauthorization** — `POST https://www.strava.com/oauth/deauthorize` is called with the stored access token. Failures are logged and ignored (non-fatal).
  3. **DB user row is deleted.** FK `ON DELETE CASCADE` cleans up: `workout_logs`, `exercise_sets`, `training_plans`, `plan_days`, `chat_messages`, `coaching_materials`, `document_chunks`, `strava_connections`, `garmin_connections`, `custom_exercises`, `push_subscriptions`, `ai_usage_logs`, `idempotency_keys`, and `timeline_annotations`.
  4. **Auth seen-cache eviction** — `evictUserFromSeenCache(userId)` prevents any in-flight session from triggering `ensureUserExists` within the 5-minute cache TTL.

---

## Workout Routes

**File:** `server/routes/workouts.ts`

### GET /api/v1/workouts

List workout logs for the current user with pagination.

- **Auth:** Required
- **Query params:** `limit` (default 50, max capped), `offset` (default 0)
- **Response:** `WorkoutLog[]`

### GET /api/v1/workouts/:id

Get a single workout log by ID.

- **Auth:** Required
- **Response:** `WorkoutLog` with `exerciseSets`
- **404:** Workout not found

### POST /api/v1/workouts

Create a new workout log, optionally with parsed exercises.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Body:** `InsertWorkoutLog` fields + optional `exercises: ParsedExercise[]`
- **Validation:** `insertWorkoutLogSchema` + `exercisesPayloadSchema`
- **Side effects:** If user has AI coach enabled, sets `isAutoCoaching` flag and queues an `auto-coach` job.
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
      "sets": [
        { "setNumber": 1, "distance": 5000, "time": 28 }
      ]
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
- **Body:** Partial `UpdateWorkoutLog` fields + optional `exercises: ParsedExercise[]`
- **Response:** Updated `WorkoutLog`

### DELETE /api/v1/workouts/:id

Delete a workout log and its exercise sets.

- **Auth:** Required
- **Rate limit:** `workout` category, 40/min
- **Response:** `{ success: true }`

### GET /api/v1/workouts/unstructured

List workouts that have no parsed exercise sets (candidates for reparsing).

- **Auth:** Required
- **Response:** `WorkoutLog[]`

### POST /api/v1/workouts/:id/reparse

Re-parse a single workout's text into structured exercise sets using Gemini AI.

- **Auth:** Required
- **Rate limit:** `reparse` category, 5/min
- **Response:** `{ exercises: ParsedExercise[], saved: boolean, setCount?: number }`

### POST /api/v1/workouts/batch-reparse

Re-parse all unstructured workouts for the current user.

- **Auth:** Required
- **Rate limit:** `batchReparse` category, 2/min
- **Response:** `{ total: number, parsed: number, failed: number }`

---

## Custom Exercise Routes

**File:** `server/routes/workouts.ts`

### GET /api/v1/custom-exercises

List all custom exercises defined by the current user.

- **Auth:** Required
- **Response:** `CustomExercise[]`

### POST /api/v1/custom-exercises

Create or upsert a custom exercise.

- **Auth:** Required
- **Rate limit:** `customExercise` category, 20/min
- **Body:** `{ name: string, category?: string }`
- **Validation:** `insertCustomExerciseSchema`
- **Response:** `CustomExercise`

---

## Training Plan Routes

**File:** `server/routes/plans.ts`

### GET /api/v1/plans

List all training plans for the current user.

- **Auth:** Required
- **Response:** `TrainingPlan[]`

### GET /api/v1/plans/:id

Get a training plan with all its days.

- **Auth:** Required
- **Response:** `TrainingPlanWithDays`

### POST /api/v1/plans/import

Import a training plan from CSV content.

- **Auth:** Required
- **Rate limit:** `planImport` category, 5/min
- **Body:** `{ csvContent: string, fileName?: string, planName?: string }`
- **Validation:** `importPlanRequestSchema` (csvContent max 100,000 chars)
- **Response:** `TrainingPlanWithDays`

### POST /api/v1/plans/sample

Create the built-in sample Hyrox training plan.

- **Auth:** Required
- **Rate limit:** `planSample` category, 5/min
- **Response:** `TrainingPlanWithDays`

### POST /api/v1/plans/generate

Generate a custom training plan using Gemini AI.

- **Auth:** Required
- **Rate limit:** `planGenerate` category, 3/min
- **Body:** `GeneratePlanInput` — `{ goal, totalWeeks (1-24), daysPerWeek (2-7), experienceLevel, raceDate?, startDate?, restDays?, focusAreas?, injuries? }`
- **Validation:** `generatePlanInputSchema`
- **Response:** `TrainingPlanWithDays`

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

### PATCH /api/v1/plans/:planId/days/:dayId

Update a plan day (simple update, no cleanup).

- **Auth:** Required
- **Rate limit:** `planDayUpdate` category, 20/min
- **Body:** Partial `UpdatePlanDay` (focus, mainWorkout, accessory, notes, status, scheduledDate)
- **Response:** Updated `PlanDay`

### PATCH /api/v1/plans/days/:dayId

Update a plan day with cleanup (unlinks workout logs when changing status away from completed).

- **Auth:** Required
- **Rate limit:** `planDayUpdate` category, 20/min
- **Body:** Partial `UpdatePlanDay`
- **Response:** Updated `PlanDay`

### PATCH /api/v1/plans/days/:dayId/status

Update only the status and/or scheduled date of a plan day.

- **Auth:** Required
- **Rate limit:** `planDayStatus` category, 20/min
- **Body:** `{ status?: "planned" | "completed" | "skipped", scheduledDate?: string | null }`
- **Response:** Updated `PlanDay`

### DELETE /api/v1/plans/:id

Delete a training plan and all its days (cascade).

- **Auth:** Required
- **Rate limit:** `planDelete` category, 10/min
- **Response:** `{ success: true }`

### DELETE /api/v1/plans/days/:dayId

Delete a single plan day.

- **Auth:** Required
- **Rate limit:** `planDayDelete` category, 10/min
- **Response:** `{ success: true }`

### POST /api/v1/plans/:planId/schedule

Schedule a plan by assigning dates to all days starting from a given date.

- **Auth:** Required
- **Rate limit:** `planSchedule` category, 10/min
- **Body:** `{ startDate: "YYYY-MM-DD" }`
- **Response:** `{ success: true }`

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

## Analytics Routes

**File:** `server/routes/analytics.ts`

All analytics endpoints support optional date filtering via query parameters: `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

**Coalesced request cache.** Exercise sets and workout logs used by these routes pass through two in-memory promise caches (`getExerciseSetsCoalesced` and `getWorkoutLogsCoalesced`) keyed by `userId + from + to`. The cache holds the *pending* promise, so three concurrent requests for the same user/window trigger a single database query. Parameters:

| Knob | Value | Source |
|---|---|---|
| TTL | 5 minutes (`ANALYTICS_CACHE_TTL_MS`) | `server/constants.ts` |
| Max entries per cache | 500 (`MAX_CACHE_SIZE`) | `server/routes/analytics.ts` |
| Eviction | Expired entries first, then oldest-by-timestamp once over the size cap | `evictStale()` |
| Failure behavior | The rejected promise is evicted so the next caller retries immediately | `.catch` in `getExerciseSetsCoalesced` / `getWorkoutLogsCoalesced` |

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
  }
  ```

- **Previous-window derivation (`computePreviousWindow`):** The previous period is the equal-length, non-overlapping range ending the day before `from`. If `to` is omitted, the current window's upper bound is pinned to midnight UTC of today (not wall-clock `now`) so the previous window doesn't drift across the day. Returns `null` when `from` is absent, and the route responds without `previousStats`.
- The client's `DeltaIndicator` component renders the percentage change between `currentStats` and `previousStats` for each of the four stat cards.

---

## AI and Chat Routes

**File:** `server/routes/ai.ts`

### POST /api/v1/parse-exercises

Parse free-text or voice input into structured exercise data using Gemini AI.

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
    "sets": [
      { "setNumber": 1, "distance": 4828, "time": 24 }
    ]
  }
]
```

### POST /api/v1/chat

Send a message to the AI coach and receive a complete response.

- **Auth:** Required
- **Rate limit:** `chat` category, 10/min
- **Body:** `{ message: string (1-1000 chars), history?: ChatMessage[] (max 20) }`
- **Validation:** `chatRequestSchema`
- **Response:** `{ response: string, ragInfo: RagInfo }`

### POST /api/v1/chat/stream

Send a message to the AI coach and receive a streaming response via Server-Sent Events.

- **Auth:** Required
- **Rate limit:** `chat` category, 10/min
- **Body:** Same as `/api/v1/chat`
- **Response headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`
- **SSE events:**
  - `{ ragInfo: RagInfo }` — First event with RAG metadata
  - `{ text: string }` — Streaming text chunks
  - `{ done: true }` — Stream complete
  - `{ error: string }` — Stream error

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

Retrieve all saved chat messages for the current user.

- **Auth:** Required
- **Response:** `ChatMessage[]`

### POST /api/v1/chat/message

Save a chat message to history.

- **Auth:** Required
- **Rate limit:** `chatMessage` category, 20/min
- **Body:** `{ userId: string, role: "user" | "assistant", content: string (1-50000 chars) }`
- **Validation:** `insertChatMessageSchema`
- **Response:** Saved `ChatMessage`

### DELETE /api/v1/chat/history

Clear all chat messages for the current user.

- **Auth:** Required
- **Rate limit:** `chatHistoryDelete` category, 5/min
- **Response:** `{ success: true }`

### POST /api/v1/timeline/ai-suggestions

Generate AI coaching suggestions for upcoming planned workouts.

- **Auth:** Required
- **Rate limit:** `suggestions` category, 3/min
- **Response:** `{ suggestions: WorkoutSuggestion[], ragInfo: RagInfo }`
- **Note:** Returns empty suggestions if no upcoming planned workouts exist.

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
- **Body limit:** 2MB (elevated from default 100kb)
- **Body:** `{ title: string (1-255 chars), content: string (1-1,500,000 chars), type: "principles" | "document" }`
- **Validation:** `insertCoachingMaterialSchema`
- **Side effects:** Queues `embed-coaching-material` job for RAG chunking/embedding.
- **Response:** `201` Created `CoachingMaterial`

### PATCH /api/v1/coaching-materials/:id

Update a coaching material. Re-embeds if content or title changed.

- **Auth:** Required
- **Rate limit:** `coaching` category, 10/min
- **Body:** Partial `{ title?, content?, type? }`
- **Side effects:** Queues re-embedding if content or title changed.
- **Response:** Updated `CoachingMaterial`

### DELETE /api/v1/coaching-materials/:id

Delete a coaching material. Document chunks are cascade-deleted via FK.

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
- **Response:** Re-embed result summary

---

## Preferences Routes

**File:** `server/routes/preferences.ts`

### GET /api/v1/preferences

Get the current user's preferences.

- **Auth:** Required
- **Response:** `{ weightUnit, distanceUnit, weeklyGoal, emailNotifications, emailWeeklySummary, emailMissedReminder, aiCoachEnabled }`

### PATCH /api/v1/preferences

Update user preferences.

- **Auth:** Required
- **Rate limit:** `preferences` category, 20/min
- **Body:** Partial `{ weightUnit?: "kg" | "lbs", distanceUnit?: "km" | "miles", weeklyGoal?: 1-14, emailNotifications?: boolean, emailWeeklySummary?: boolean, emailMissedReminder?: boolean, aiCoachEnabled?: boolean }`
- **Validation:** `updateUserPreferencesSchema`
- **Response:** Updated preferences object
- **Email toggle semantics:** `emailNotifications` is the master switch — when `false`, no email is sent regardless of the per-type flags. `emailWeeklySummary` and `emailMissedReminder` gate the individual categories and take effect only when the master is on. All three default to `false` at the database level for new users (GDPR-compliant opt-in).
- **AI consent semantics:** `aiCoachEnabled` gates every outbound call to Google Gemini (workout parsing, chat, auto-coach). It defaults to `false` for new users; the AI features are hidden or disabled in the UI until the user explicitly opts in. Flipping it to `false` immediately stops new Gemini requests; already-persisted chat history and plan AI artifacts remain until the user deletes them.

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
- **Response:** Cron job result summary

---

## Strava Routes

**File:** `server/strava.ts`

### GET /api/v1/strava/status

Check if the current user has a Strava connection.

- **Auth:** Required
- **Response:** `{ connected: boolean, lastSyncedAt?: string }`

### GET /api/v1/strava/auth

Generate a Strava OAuth authorization URL with CSRF-protected signed state.

- **Auth:** Required
- **Rate limit:** IP-based, 20 per 15 minutes
- **Response:** `{ url: string }` — Redirect URL for Strava OAuth
- **State parameter:** HMAC-SHA256 signed with `userId:timestamp:nonce:signature`, max age enforced

### GET /api/v1/strava/callback

OAuth callback handler. Exchanges authorization code for tokens, encrypts and stores them.

- **Auth:** Not required (redirect from Strava)
- **Rate limit:** IP-based, 20 per 15 minutes
- **Query:** `code`, `state` (CSRF-verified), `scope`
- **Side effects:** Creates `stravaConnections` record with AES-256-GCM encrypted tokens
- **Response:** Redirect to `/settings`

### POST /api/v1/strava/sync

Sync recent Strava activities into workout logs.

- **Auth:** Required
- **Rate limit:** IP-based, 5 per 15 minutes
- **Side effects:** Fetches activities from Strava API, maps to WorkoutLog format, deduplicates by `stravaActivityId`, auto-refreshes expired tokens.
- **Response:** `{ imported: number }` or `{ message: string }`

### DELETE /api/v1/strava/disconnect

Disconnect the Strava integration.

- **Auth:** Required
- **Response:** `{ success: true }`

---

## Garmin Routes

**File:** `server/garmin.ts`

Garmin Connect sync uses a reverse-engineered SSO flow (email + password), not a public OAuth application. See [Integrations → Garmin Connect](integrations.md#garmin-connect-integration) for the rationale, safety stack, and storage model.

All mutating routes apply `protectedMutationGuards` (auth + CSRF + idempotency). Every route short-circuits with HTTP 503 `GARMIN_CIRCUIT_OPEN` when the global 429 circuit breaker is tripped.

### GET /api/v1/garmin/status

Returns the Garmin connection state for the authenticated user.

- **Auth:** Required
- **Response:** `{ connected: false }` or `{ connected: true, garminDisplayName: string | null, lastSyncedAt: string | null, lastError: string | null }`

### POST /api/v1/garmin/connect

Authenticate with Garmin using email + password and persist the encrypted credentials / OAuth tokens.

- **Auth:** Required
- **Rate limit:** `garmin-connect` category, 5 per 15-minute window per user
- **Body:** `{ email: string (valid email, max 254), password: string (1-256) }`
- **Behavior:** Logs into Garmin *before* writing any DB row — nothing is stored on failure. Fetches `getUserProfile()` to capture the display name (optional; non-fatal if it fails).
- **Responses:**
  - `200 { success: true, garminDisplayName: string | null }`
  - `400 { code: "BAD_REQUEST" }` — invalid email / empty password
  - `401 { code: "GARMIN_AUTH_FAILED" }` — invalid credentials or 2SV enabled (see error translation in `server/garmin.ts`)
  - `409 { code: "GARMIN_BUSY" }` — another Garmin op for the same user is in progress (per-user mutex)
  - `503 { code: "GARMIN_CIRCUIT_OPEN" }` — global 429 breaker is tripped

### DELETE /api/v1/garmin/disconnect

Removes the `garmin_connections` row for the user (credentials, tokens, display name).

- **Auth:** Required
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

**File:** `server/routes/workouts.ts`

### GET /api/v1/timeline

Get merged timeline of planned and logged workouts.

- **Auth:** Required
- **Query:** `planId?` (filter by plan), `limit?` (default capped), `offset?`
- **Response:** `TimelineEntry[]` — merged planned + logged workouts sorted by date

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

Get historical exercise sets for a specific exercise.

- **Auth:** Required
- **Response:** Exercise set history with dates

### GET /api/v1/export

Export all training data as CSV or JSON.

- **Auth:** Required
- **Rate limit:** `export` category, 5/min
- **Query:** `format` — `"csv"` (default) or `"json"`
- **Response:** File download with appropriate Content-Type and Content-Disposition headers

---

## See Also

- [AI and RAG](ai-and-rag.md) -- Architecture of the RAG pipeline, embedding strategy, and coaching material processing.
- [Authentication](authentication.md) -- Clerk JWT setup, middleware configuration, and session management.
