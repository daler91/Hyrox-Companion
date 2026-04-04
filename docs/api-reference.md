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
- [Request Validation](#request-validation)
- [Auth Routes](#auth-routes)
- [Workout Routes](#workout-routes)
- [Custom Exercise Routes](#custom-exercise-routes)
- [Training Plan Routes](#training-plan-routes)
- [Analytics Routes](#analytics-routes)
- [AI and Chat Routes](#ai-and-chat-routes)
- [Coaching Material Routes](#coaching-material-routes)
- [Preferences Routes](#preferences-routes)
- [Email Routes](#email-routes)
- [Strava Routes](#strava-routes)
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

## Analytics Routes

**File:** `server/routes/analytics.ts`

All analytics endpoints support optional date filtering via query parameters: `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Results are cached per-user with a configurable TTL to avoid redundant database queries.

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

Calculate weekly training summaries, category totals, and station coverage.

- **Auth:** Required
- **Rate limit:** `analytics` category, 20/min
- **Query:** `from?`, `to?`
- **Response:** `TrainingOverview` — `{ weeklySummaries, workoutDates, categoryTotals, stationCoverage }`

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
- **Response:** `{ weightUnit, distanceUnit, weeklyGoal, emailNotifications, aiCoachEnabled }`

### PATCH /api/v1/preferences

Update user preferences.

- **Auth:** Required
- **Rate limit:** `preferences` category, 20/min
- **Body:** Partial `{ weightUnit?: "kg" | "lbs", distanceUnit?: "km" | "miles", weeklyGoal?: 1-14, emailNotifications?: boolean, aiCoachEnabled?: boolean }`
- **Validation:** `updateUserPreferencesSchema`
- **Response:** Updated preferences object

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

### POST /api/v1/strava/disconnect

Disconnect the Strava integration.

- **Auth:** Required
- **Response:** `{ success: true }`

---

## Timeline and Export Routes

**File:** `server/routes/workouts.ts`

### GET /api/v1/timeline

Get merged timeline of planned and logged workouts.

- **Auth:** Required
- **Query:** `planId?` (filter by plan), `limit?` (default capped), `offset?`
- **Response:** `TimelineEntry[]` — merged planned + logged workouts sorted by date

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
