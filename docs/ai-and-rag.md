# AI and RAG Pipeline

[Back to README](../README.md)

## Overview

fitai.coach routes text AI through a modular provider layer for workout parsing, coaching chat, suggestions, review notes, coach insights, and training plan generation. Gemini remains the default text provider, while Anthropic and OpenAI-compatible providers can be selected by environment variables. A Retrieval-Augmented Generation (RAG) pipeline enriches AI responses with user-uploaded coaching materials stored as Gemini-generated vector embeddings in pgvector.

**AI consent gate.** Every outbound AI request for workout parsing, chat (regular + streaming), auto-coach, suggestions, plan generation, embeddings, and image parsing is gated on `user.aiCoachEnabled` (defaults `false` for new users). When the flag is `false`, the coach service short-circuits (`triggerAutoCoach` returns `{ adjusted: 0 }` early in `server/services/coachService.ts`) and the chat/parsing routes are blocked by the `aiConsentCheck` middleware (403 `AI_COACH_DISABLED`). The UI hides or disables the AI features until the user flips the toggle in Settings -> Preferences, and flipping it back to `false` stops new AI requests immediately.

**Key dependencies:**
- `@google/genai` -- Google Gemini API client for the default text provider, embeddings, and image parsing
- Native `fetch` -- Anthropic and OpenAI-compatible text provider adapters
- pgvector -- PostgreSQL vector extension for semantic search
- Zod -- Structured output validation

Provider selection is operator-only in this release. Set `AI_TEXT_PROVIDER`
to `gemini`, `anthropic`, or `openai-compatible`; RAG embeddings and image
parsing (photo-to-workout, nutrition meal photos and label scans) still
require `GEMINI_API_KEY`.

---

## Table of Contents

- [Text Provider Layer and Gemini Client](#text-provider-layer-and-gemini-client)
- [Workout Parsing](#workout-parsing)
- [AI Coach Chat](#ai-coach-chat)
- [Auto-Coach Pipeline](#auto-coach-pipeline)
- [RAG Pipeline](#rag-pipeline)
- [AI Plan Generation](#ai-plan-generation)
- [Prompt Templates](#prompt-templates)
- [Context Building](#context-building)
- [Security](#security)
- [Configuration](#configuration)

---

## Text Provider Layer and Gemini Client

**Files:** `server/ai/providers/*`, `server/ai/retry.ts`, `server/ai/circuitBreaker.ts`, `server/ai/geminiSdk.ts`, `server/gemini/client.ts`

The text provider layer (`config.ts`, `index.ts`, `types.ts`, `http.ts`,
`gemini.ts`, `anthropic.ts`, `openaiCompatible.ts`) exposes a canonical
`TextAiProvider` interface (`generateText` + `streamText`) plus the
`generateText`/`generateJsonText`/`streamText` entry points in `index.ts`.
The active provider is chosen by `AI_TEXT_PROVIDER`, and `getTextAiProvider()`
builds and caches a single instance. Each request resolves a per-role model
(`fast` vs `reasoning`) via `resolveTextAiModel()`. The shared pieces live in
`server/ai/` (retry, timeout, circuit breaker, Gemini SDK factory) and
`server/gemini/client.ts` (embeddings); `client.ts` re-exports `getAiClient`,
`retryWithBackoff`, `withTimeout` and `isRetryableError` so older importers
keep working:

- **Singleton client:** `getAiClient()` (`server/ai/geminiSdk.ts`) lazily initializes a `GoogleGenAI` instance using `GEMINI_API_KEY`, and throws while `AI_FEATURES_ENABLED=false`.
- **Models:**
  - `gemini-2.5-flash-lite` -- Used for exercise parsing (fast, low-cost).
  - `gemini-3.1-pro-preview` -- Used for coaching chat, suggestions, and plan generation (higher quality, with thinking enabled).
- **Retry with backoff:** `retryWithBackoff(fn, label, maxRetries, baseDelayMs, budgetMs, callTimeoutMs)` (`server/ai/retry.ts`, used by all three provider adapters for non-streaming calls) retries on rate limits (429), server errors (500/503), and network failures or timeouts. Exponential backoff (2s base, up to 4 retries, with jitter) inside a total budget (120s by default); each attempt is capped (90s by default) and aborted through the `AbortSignal` passed to `fn`.
- **Timeout:** `withTimeout(promise, ms, label, onTimeout?)` (`server/ai/retry.ts`) races a promise against a configurable timeout.
- **Embedding:** `generateEmbedding(text)` and `generateEmbeddings(texts)` (`server/gemini/client.ts`) produce 3072-dimensional vectors using `gemini-embedding-001`. Batch embeddings process in groups of 5 with 200ms inter-batch delay to avoid rate limiting. Repeat lookups of the same text are served from a process-local LRU cache (256 entries, 1h TTL), which is deliberately not shared through `server_runtime_cache`.

### Model Selection

| Model | Used For | Rationale |
|-------|----------|-----------|
| `gemini-2.5-flash-lite` | Exercise parsing | Fast and low-cost. Parsing is a structured extraction task that maps free-text to a fixed JSON schema -- it does not require deep reasoning or nuanced coaching knowledge. |
| `gemini-3.1-pro-preview` | Coaching chat, workout suggestions, plan generation | Higher quality with `ThinkingLevel.HIGH` enabled. These tasks require deeper reasoning about training periodization, fatigue management, and personalized coaching decisions based on complex athlete context. |

### Circuit Breaker

**File:** `server/ai/circuitBreaker.ts`

One process-wide breaker sits in front of every provider call: `retryWithBackoff()` checks it before its first attempt (which covers text generation, embeddings, and image parsing), and the streaming facade (`streamText()` in `server/ai/providers/index.ts`) checks and feeds it too, since streams are never retried.

- **Closed → open:** after 5 consecutive failed calls (`FAILURE_THRESHOLD`). A call counts once, after its retries are exhausted, and only when the failure says something about the provider's health: 400/404/422 and "invalid request"-style errors are ignored, while auth failures (401/403) and rate limits (429) count.
- **Open:** calls fail fast with `CircuitBreakerOpenError` ("AI provider temporarily unavailable (circuit breaker open)") for 30 seconds (`COOLDOWN_MS`).
- **Half-open:** after the cooldown a single probe call goes through; success closes the breaker, a provider failure re-opens it for another cooldown. A probe that never reports back is released after 10 seconds (`PROBE_TIMEOUT_MS`).
- **Persistence:** every transition is written to `server_runtime_cache` (`ai-circuit-breaker:state`, 1-hour TTL), and `loadPersistedBreakerState()` restores it during [startup maintenance](integrations.md#startup-maintenance), so a deploy in the middle of a provider outage does not reset the breaker to closed. A persisted half-open state is restored as open.

---

## Workout Parsing

**Files:** `server/gemini/exerciseParser.ts` (barrel re-export), `server/gemini/exerciseParser/` (`text.ts` for free-text parsing, `image.ts` for photo-to-workout parsing, plus `schema.ts`, `mapping.ts`, `provider.ts`, `validation.ts`, `fallback.ts`, `structure.ts`)

Transforms free-text, voice, or photo input into structured exercise data.

### Flow

1. User submits text (e.g., "3 sets bench 225lbs x 8, then 3 miles in 24 min")
2. The parser builds a prompt with:
   - `PARSE_EXERCISES_PROMPT` system instruction
   - Unit awareness (kg/lbs based on user preference, with conversion rules)
   - Custom exercise names (if any saved by the user)
3. The selected text provider returns JSON through the provider facade's JSON mode
4. Response is validated with `parsedExerciseSchema` (Zod)
5. Exercises are post-processed:
   - Known exercises get 95% confidence; unknown get 50%
   - Unknown exercise names are mapped to `"custom"` with the original name as `customLabel`
   - Invalid categories fall back to `"conditioning"`
   - All text is HTML-sanitized

### ParsedExercise Output

```typescript
{
  exerciseName: string;     // Standard name or "custom"
  category: string;         // e.g., "strength", "running", "conditioning"
  customLabel?: string;     // Original name for custom exercises
  confidence: number;       // 0-100, AI's confidence in the parse
  missingFields?: string[]; // Fields the AI couldn't determine
  sets: Array<{
    setNumber: number;
    reps?: number;
    weight?: number;
    distance?: number;
    time?: number;
  }>;
}
```

### API Endpoint

`POST /api/v1/parse-exercises` -- Rate limited to 5/min.

See also: [API Reference -- AI Routes](api-reference.md#ai-and-chat-routes)

---

## AI Coach Chat

**Files:** `server/gemini/chatService.ts`, `server/routes/ai.ts`

### Regular Chat

`chatWithCoach()` sends the full conversation history to the configured text provider and returns a complete response. Gemini remains the default; non-Gemini providers are selected through `AI_TEXT_PROVIDER`.

### Streaming Chat

`streamChatWithCoach()` is an `AsyncGenerator<string>` that yields text chunks. It accepts an optional `AbortSignal` parameter, allowing the caller to cancel provider generation mid-stream. The route handler (`POST /api/v1/chat/stream`) serves these as Server-Sent Events:

```
data: {"ragInfo": {"source": "rag", "chunkCount": 3}}   // First event
data: {"text": "Based on your recent..."}                 // Text chunks
data: {"text": " training data, I recommend..."}
data: {"done": true}                                      // Stream complete
```

The server propagates an `AbortSignal` to the provider adapter when the SSE client disconnects. This cancels in-flight token generation promptly where the upstream API supports aborts. The signal is constructed from the request's `close` event and passed through the streaming pipeline.

### Complete Streaming Example

A full SSE event sequence for a coaching chat request:

```
data: {"ragInfo":{"source":"rag","chunkCount":3}}

data: {"text":"Based on your"}

data: {"text":" recent training data, I recommend"}

data: {"text":" reducing your squat volume this week."}

data: {"done":true}
```

Each SSE event is separated by a double newline (`\n\n`). The first event always carries `ragInfo` metadata so the client knows which retrieval method was used. Subsequent events stream text chunks as they arrive from the selected provider. The final event carries `{"done":true}` to signal stream completion.

On the client side, text chunks are buffered and rendered via `requestAnimationFrame` to avoid layout thrashing during rapid chunk delivery. On the server side, the route handler propagates an `AbortSignal` to cancel the provider stream when the client disconnects, preventing unnecessary token generation and API costs where supported.

### Chat History

- `GET /api/v1/chat/history` -- Retrieve saved messages
- `POST /api/v1/chat/message` -- Save a message (max 50,000 chars)
- `DELETE /api/v1/chat/history` -- Clear all messages
- History is truncated to the last 20 messages in chat requests via `chatRequestSchema`

### RagInfo

Every chat response includes `RagInfo` metadata:

```typescript
{
  source: "rag" | "legacy" | "none"; // Which retrieval method was used
  chunkCount: number;                // Number of RAG chunks retrieved
  chunks?: string[];                 // Chunk contents (dev only)
  materialCount?: number;            // Legacy material count
  fallbackReason?: string;           // Why RAG wasn't used (dev only)
}
```

In production, `chunks` and `fallbackReason` are stripped by `sanitizeRagInfo()`.

### Plan Editing From Chat

**Files:** `server/services/chatIntentService.ts`, `server/services/planAdjustmentService.ts`, `server/gemini/planAdjustmentService.ts`, `server/routes/planProposals.ts`

On the streaming route (`POST /api/v1/chat/stream`), a message asking for a plan change gets a structured proposal instead of a prose reply:

1. **Intent gate.** A free keyword scan (`hasPlanEditKeywords()`: day names, "move", "skip", "easier", "travel", and so on) decides whether to classify at all; `classifyPlanEditIntent()` then asks the fast model, with the last two user turns as context. Only `plan_modification` at confidence ≥ 0.7 proceeds. A request can opt out with `planEditing: false`, and any error in this branch falls back to the normal chat stream.
2. **Proposal.** `createPlanAdjustmentProposal()` shows the reasoning model (`PLAN_ADJUSTMENT_PROMPT`) up to 28 upcoming planned days. Changes to days outside that set are dropped, as are `focus`/`mainWorkout`/`accessory` edits to structure-block (EMOM/AMRAP) days. A red-flag safety signal answers with the safety escalation note instead; no upcoming days, or no change surviving the checks, answers in plain text; a failed generation falls back to the normal chat stream. Otherwise the proposal is stored as `pending` in `plan_adjustment_proposals` (superseding any earlier pending one) and the stream sends its summary text plus a `planProposal` event.
3. **Apply or dismiss.** The athlete decides via `POST /api/v1/plan-proposals/:id/apply` or `/dismiss` (see [API Reference → Plan Proposal Routes](api-reference.md#plan-proposal-routes)). Apply re-checks every targeted day first: if any is no longer `planned` or has changed since the proposal was built, the whole proposal is marked `invalidated` (409 `stale`). Otherwise table-backed days whose `mainWorkout`/`accessory` text changes are re-parsed into structured rows, all changes are written in one transaction, and the proposal becomes `applied`.
4. **Auto-apply.** With the `coachAutoApplyPlanChanges` preference on (Settings → "Auto-Apply Chat Plan Changes", default off), the proposal is applied as soon as it is created; if applying fails it keeps its status (pending, or invalidated) for the athlete to retry or dismiss.

---

## Auto-Coach Pipeline

**File:** `server/services/coachService.ts`

Automatically adjusts upcoming plan days after a workout is completed.

### Flow

1. **Trigger:** Five events queue an `auto-coach` pg-boss job through `server/services/autoCoachQueue.ts`: a workout created, a logged workout moved to another date, sets edited on an existing workout log, a plan day completed, and a plan day rescheduled (see [What Triggers A Pass](ai-coach-auto-regulation-flow.md#what-triggers-a-pass)). Every producer shares the singleton key `auto-coach:<userId>` with a 60-second window, so a burst of edits collapses into one pass per athlete. Only workout creation (`POST /api/v1/workouts`, via `createWorkoutAndScheduleCoaching()`) also sets `isAutoCoaching = true`, in the same transaction as the insert and only when `aiCoachEnabled`.
2. **Client polling:** The `useAuth` hook polls `isAutoCoaching` every 2 seconds (max 5 minutes) to show a loading indicator.
3. **`triggerAutoCoach(userId)`:**
   - Checks if AI coach is enabled; if not, returns `{ adjusted: 0 }` (the `finally` block still clears the flag).
   - Skips when the user is over the rolling 24h AI budget.
   - Calls `buildTrainingContext()`, which already fetches the active plan, upcoming planned days, and recent timeline (no duplicate `getActivePlan` / `getTimeline` calls).
   - Maps upcoming planned workouts (those with a `planDayId`) into the suggestion-generator shape.
   - Retrieves coaching materials via RAG (or legacy fallback).
   - Calls `generateWorkoutSuggestions()` with the training context, upcoming workouts, plan goal, and coaching materials.
   - Runs each suggestion through the safety layer (`applySafetyLayerToSuggestions`) and the modification guard (`shouldSuppressRepeatedFatigueReduction`) before applying.
   - Applies surviving modifications and review notes atomically inside a single `db.transaction()`.
   - Resets `isAutoCoaching = false` in a `finally` block.
4. **Suggestion application:** Suggestions specify a `targetField` (`mainWorkout`, `accessory`, or `notes`) and an `action` (`replace` or `append`). A text append written by the auto-coach goes on a new line prefixed with `[AI Coach]` (`buildUpdateValue()` in `coachService.ts`). A suggestion the athlete applies by hand (`POST /api/v1/timeline/ai-suggestions/apply` → `applyTimelineAiSuggestion()` in `server/services/aiSuggestionService.ts`) is appended after a blank line, prefixed with `AI suggestion:`.

### Repeated-Modification Guard

**File:** `server/services/aiModificationGuard.ts`

To prevent the auto-coach from repeatedly cutting volume on the same workout across consecutive runs, every fatigue-driven suggestion passes through `shouldSuppressRepeatedFatigueReduction()`:

- `classifyCoachModification()` tags a suggestion as `fatigue_volume_reduction` when an active fatigue signal (`fatigueFlag` or RPE `rising`) coincides with fatigue and reduction keywords in the recommendation/rationale.
- `buildWorkoutPrescriptionFingerprint()` computes a SHA-256 hash over the workout's normalized `mainWorkout`, `accessory`, `notes`, and sorted `exerciseDetails`.
- A repeat reduction is suppressed when the prior `lastFatigueReduction` metadata carries the same prescription fingerprint **and** no new workouts have been completed since that modification.
- `withCoachModificationMetadata()` stamps the applied modification onto `CoachNoteInputs` (`lastModification` / `lastFatigueReduction`) so the next run can detect the repeat.

See also: [Integrations -- pg-boss Job Queue](integrations.md#job-queue-pg-boss)

### WorkoutSuggestion

```typescript
{
  workoutId: string;
  workoutDate: string;
  workoutFocus: string;
  targetField: "mainWorkout" | "accessory" | "notes";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}
```

---

## RAG Pipeline

For a sequence diagram of the full upload → chunk → embed → persist path, see [architecture.md § 3b — RAG Ingest Pipeline](architecture.md#3b-rag-ingest-pipeline). The complementary read-path decision tree lives in [architecture.md § 4](architecture.md#4-rag-retrieval-decision-tree).

### Document Chunking

**File:** `server/services/ragService.ts`

1. **Input:** User uploads a coaching material (text content up to 1.5M characters).
2. **Chunking:** `chunkText(text)` splits content into overlapping chunks:
   - **Chunk size:** Configurable via `RAG_CHUNK_SIZE` (default 600 chars).
   - **Overlap:** Configurable via `RAG_CHUNK_OVERLAP` (default 100 chars).
   - **Boundary detection:** Prefers breaking at paragraph boundaries (`\n\n`), then sentence boundaries (`. `), falling back to raw character limit.
   - The material title is prepended to the first chunk for semantic context.
3. **Embedding:** Each chunk is embedded via `generateEmbeddings()` (Gemini `gemini-embedding-001`, 3072 dimensions). Processed in batches of 5 with 200ms delay.
4. **Storage:** Chunks and embeddings are stored in the `document_chunks` table. Old chunks are replaced transactionally via `storage.coaching.replaceChunks()`.

### Embedding Trigger

Embedding is triggered asynchronously via pg-boss queue (`embed-coaching-material` job) when:
- A coaching material is created
- A coaching material's content or title is updated

### Retrieval

**File:** `server/services/ragRetrieval.ts`

`retrieveCoachingContext(userId, query, log)` is the main retrieval entry point:

1. Check if the user has any document chunks (`storage.coaching.hasChunksForUser()`).
2. If chunks exist, verify embedding dimensions match (detects model changes).
3. Generate a query embedding and search via `storage.coaching.searchChunksByEmbedding()` (cosine distance, top-6 by default).
4. If RAG succeeds, return chunks with `ragInfo.source = "rag"`.
5. If RAG fails (no chunks, dimension mismatch, retrieval error), fall back to legacy full-text coaching materials with `ragInfo.source = "legacy"`.
6. If no coaching materials exist at all, return `ragInfo.source = "none"`.

### RAG Retrieval Decision Tree

```mermaid
flowchart TD
    A[retrieveCoachingContext] --> B{hasChunksForUser?}
    B -- no --> F[listCoachingMaterials]
    B -- yes --> C{storedDim == EMBEDDING_DIMENSIONS?}
    C -- "no (dimension_mismatch)" --> F
    C -- "null (no_embeddings)" --> D[vectorSearch top-6]
    C -- yes --> D
    D --> E{results > 0?}
    E -- yes --> G["return RAG\nsource='rag'"]
    E -- "no (no_matching_chunks)" --> F
    F --> H{materials.length > 0?}
    H -- yes --> I["return legacy\nsource='legacy'"]
    H -- no --> J["return none\nsource='none'"]
    A -. "catch (retrieval_error)" .-> F
```

**fallbackReason values:**

| Value | Trigger |
|-------|---------|
| `dimension_mismatch` | Stored embedding dimension differs from `EMBEDDING_DIMENSIONS` (model changed). Fix by re-embedding via settings. |
| `no_embeddings` | Chunks exist in the database but none have embedding vectors yet. |
| `no_matching_chunks` | Vector search executed successfully but returned 0 results for the query. |
| `retrieval_error` | An exception was thrown during the retrieval attempt (network, database, etc.). |

### RAG Status

`GET /api/v1/coaching-materials/rag-status` returns diagnostic info:
- Per-material chunk counts and embedding status
- Embedding API health (probes with a test embedding)
- Dimension mismatch detection (stored vs. expected)
- Total chunk count

### Re-embedding

`POST /api/v1/coaching-materials/re-embed` re-chunks and re-embeds all materials. Uses `Promise.allSettled()` for resilience -- individual failures don't block others.

See also: [Database -- documentChunks table](database.md#schema-tables)

---

## AI Plan Generation

**File:** `server/services/planGenerationService.ts`

Generates structured multi-week training plans via the configured text provider.

### Input (GeneratePlanInput)

| Field | Type | Description |
|-------|------|-------------|
| `goal` | string (required) | Training goal (max 500 chars) |
| `daysPerWeek` | number | 2-7, default 5 |
| `experienceLevel` | enum (required) | `"beginner"`, `"intermediate"`, `"advanced"` |
| `startDate` | string (required) | `YYYY-MM-DD`, when the plan begins |
| `endDate` | string (required) | `YYYY-MM-DD`, after `startDate`. The plan length is derived from the span (`computePlanWeeks()`, 1-24 weeks); there is no separate weeks field |
| `endDateIsRaceDate` | boolean? | Default `true`: the end date is the race the plan peaks for (stored as the plan's `raceDate`) |
| `restDays` | string[]? | Days of the week that must be rest days |
| `focusAreas` | string[]? | Priority training areas (max 10) |
| `injuries` | string? | Injuries/limitations to avoid (max 500 chars); also saved to the athlete's profile as `trainingConstraints` |
| `supersedePlanIds` | string[]? | Up to 5 plans the athlete is switching away from; retired only if this plan generates successfully |

### Flow

Generation is asynchronous. `POST /api/v1/plans/generate` refuses a second in-flight generation for the same athlete (409 `PLAN_GENERATION_IN_PROGRESS`), creates the plan row with `generationStatus: "pending"` (`createPendingPlan()`), enqueues a `plan-generation` pg-boss job (no retries; see [Integrations → Job Types](integrations.md#job-types)), and returns `202` with that stub. The client polls `GET /api/v1/plans/:id/generation-status`. The worker runs `executePlanGeneration()`:

1. Marks the plan `generating` and gathers calibration: the athlete's current training-load posture (for the opening week) and per-exercise load anchors from the last 70 days, plus declared absences inside the plan window. If calibration fails, the plan is generated without it.
2. Splits the plan into 2-week chunks (`PLAN_GENERATION_CHUNK_WEEKS`) and generates them in parallel, at most 3 at a time (`pLimit(PLAN_CHUNK_CONCURRENCY)`). Each chunk is one JSON-mode request to the reasoning model with the prompt from `buildGenerationPrompt()` for its week range, and a 5-minute timeout (`PLAN_GENERATION_AI_TIMEOUT_MS`).
3. Each response is validated against `generatedDaySchema` (Zod); invalid days and exercises are dropped with a warning, and `&` is rewritten to `and` in day text and exercise labels.
4. The combined days must cover every week with all seven days exactly once, and every non-rest day must carry exercise-table rows, or the generation fails (502 `AI_ERROR`). An exercise whose heaviest weight rises more than 8% week over week (`MAX_WEEKLY_WEIGHT_INCREASE_PCT`) is clamped to that ceiling.
5. Plan days and their exercise sets are written in one transaction, and the plan is scheduled from `startDate` (week 1 aligned to that week's Monday).
6. A final transaction retires the plans in `supersedePlanIds` and marks this one `ready`. Any error marks it `failed` with a client-safe `generationError`.

### API Endpoint

`POST /api/v1/plans/generate` -- Rate limited to 3/min.

---

## Prompt Templates

**Files:** `server/prompts.ts` (prompt strings + `buildSystemPrompt`), `server/prompts/` (`coachingContext.ts` for training-data sections, `materialsBuilder.ts` for coaching-material/RAG-chunk sections, `exerciseSetFormatter.ts` for structured exercise-set formatting)

### BASE_SYSTEM_PROMPT

The core coaching persona. Covers:
- Multi-goal coaching (Hyrox, endurance, strength, weight loss, general fitness)
- Hyrox-specific knowledge (8 stations, distances, race format)
- Instructions for using training data context
- Security instruction: refuses to reveal system prompts

### SUGGESTIONS_PROMPT

Detailed instructions for the auto-coach. Includes:
- Phase-based coaching (Early, Build, Peak, Taper, Race Week)
- Workout type awareness (Shakeout, Recovery, Deload, Benchmark, Simulation)
- Response to coaching analysis (fatigue, undertraining, exercise gaps, plateaus)
- Hyrox-specific coaching (grip fatigue, transitions, station substitutes)
- Running-focused coaching (periodization, easy/tempo/interval balance)
- Modification priority hierarchy (adjust intensity > swap exercises > rewrite > add accessory > coaching cues)

### PARSE_EXERCISES_PROMPT

Instructions for parsing free-text into structured exercise data. Defines valid exercise names, categories, and output JSON format.

### Prompt Excerpts

**BASE_SYSTEM_PROMPT -- Persona and Hyrox knowledge:**

```text
You are an expert AI fitness coach. You help athletes plan, track, and optimize
their training for any fitness goal -- from running races and functional fitness
competitions (like Hyrox) to strength building, weight loss, and general health.

You adapt your coaching based on the athlete's goal:
- Functional fitness / Hyrox: Hyrox is a fitness race with 8x 1km runs between
  8 functional stations (SkiErg 1000m, Sled Push 50m, Sled Pull 50m,
  Burpee Broad Jumps 80m, Rowing 1000m, Farmers Carry 200m,
  Sandbag Lunges 100m, Wall Balls 75-100 reps). Focus on station practice,
  running endurance, grip management, and race-day pacing.
- Endurance / Running: Focus on periodization, pacing, mileage progression,
  easy/tempo/interval balance, and race-specific preparation.
- Strength: Focus on progressive overload, compound lifts, programming
  periodization, and recovery.
- Weight loss: Balanced training with sustainable intensity, caloric awareness,
  and habit building.
- General fitness: Well-rounded approach across running, strength, and
  conditioning.
```

**SUGGESTIONS_PROMPT -- Phase-based coaching rules:**

```text
PHASE-BASED COACHING:
- EARLY (first 25% of plan): Build aerobic base, establish movement patterns.
  Moderate volume, low-moderate intensity. Add form cues in notes. Don't push
  heavy loads yet.
- BUILD (25-60%): Progressive overload -- increase weights/reps/distance in
  small increments (2.5-5% per week). For functional fitness goals, ensure all
  functional exercises get practice at least once every 10 days. Build running
  volume.
- PEAK (60-85%): Highest intensity. For functional fitness: simulation workouts
  (back-to-back stations with runs). Race-pace intervals. Full circuits.
  Maintain strength, don't add new exercises.
- TAPER (85-100%): Reduce volume 30-40% but maintain intensity. Shorter
  sessions, focus on sharpness and confidence. No new exercises or heavy loads.
  Do NOT add accessory work -- remove or simplify existing accessory instead.
  Station gaps are NOT urgent during taper.
- RACE WEEK: Light movement ONLY. Max 20-30 minutes per session. Short easy
  jogs, activation drills, light mobility. Do NOT add any station practice,
  running intervals, or strength work.
```

**PARSE_EXERCISES_PROMPT -- Exercise categories and confidence scoring:**

```text
Available exercises and their keys:
FUNCTIONAL: skierg, sled_push, sled_pull, burpee_broad_jump, rowing,
            farmers_carry, sandbag_lunges, wall_balls
RUNNING:    easy_run, tempo_run, interval_run, long_run
STRENGTH:   back_squat, front_squat, deadlift, romanian_deadlift, bench_press,
            overhead_press, pull_up, bent_over_row, lunges, hip_thrust
CONDITIONING: burpees, box_jumps, assault_bike, kettlebell_swings, battle_ropes

Categories: functional, running, strength, conditioning

CONFIDENCE SCORING:
- 95-100: Exact match to a known exercise (e.g. "back squat" -> back_squat)
- 80-94:  Strong match with minor ambiguity (e.g. "squats" -> back_squat)
- 60-79:  Reasonable guess but could be wrong (e.g. "presses" -> bench_press
          vs overhead_press)
- 40-59:  Weak match, mapped to custom (e.g. unfamiliar abbreviation)
- 0-39:   Very uncertain, likely custom exercise with unclear details
```

### PLAN_GENERATION_PROMPT

Instructions for generating multi-week training plans with day-by-day structure.

### Helper Functions

- `buildSystemPrompt(trainingContext, coachingMaterials, retrievedChunks)` -- Assembles the full system prompt with training stats and coaching materials. When `retrievedChunks` is provided it takes priority over `coachingMaterials` (`server/prompts.ts`).
- `buildCoachingMaterialsSection(materials)` -- Formats legacy coaching materials (`server/prompts/materialsBuilder.ts`).
- `buildRetrievedChunksSection(chunks)` -- Formats RAG-retrieved chunks (`server/prompts/materialsBuilder.ts`).
- `buildOverallStats` / `buildExerciseFocus` / `buildStructuredPerformance` / `buildRecentWorkouts` / `buildUpcomingWorkouts` -- Format the training-data sections of the system prompt (`server/prompts/coachingContext.ts`).

---

## Context Building

**File:** `server/services/aiContextService.ts`

`buildAIContext(userId, query, log)` is the shared context builder used by both chat and suggestion endpoints. It parallelizes two independent data fetches:

```typescript
const [trainingContext, coachingContext] = await Promise.all([
  buildTrainingContext(userId),                     // Last 12 weeks of stats
  retrieveCoachingContext(userId, query, log),      // RAG or legacy materials
]);
```

### TrainingContext (from `server/services/ai/`)

Aggregates the user's training state:
- Workout counts (total, completed, planned, missed, skipped)
- Completion rate and current streak
- Recent workouts with exercise details (last 12 weeks)
- Upcoming planned workouts
- Exercise breakdown (category counts)
- Structured exercise stats (max weight, max distance, best time per exercise)
- Active plan info (name, weeks, current week, goal)
- **Coaching insights:** RPE trends, fatigue/undertraining flags, station gaps, recent skips with their reasons (`recentSkips`, up to 5), plan phase, weekly volume trends, progression flags per exercise, the training-load governor overview (`loadGovernor`, from `calculateTrainingLoad()` over the last 70 days), and the rule-based training-state decision (`decisionTree` from `decideTrainingState()`: phase, allowed workout types, whether intensity is permitted, rationale codes). When the data supports them, it also carries personal records, PRs this week, plan compliance, neglected movement patterns and muscle groups, and race readiness.

---

## Coaching Insights

**File:** `server/services/ai/coachingInsights.ts`

The coaching insights module computes seven analytical dimensions from the athlete's timeline data. These are included in every `TrainingContext` and injected into the AI system prompt so the model can make data-driven coaching decisions. `buildTrainingContext()` (`server/services/ai/index.ts`) adds signals computed outside this module to the same `coachingInsights` object: `recentSkips` (`server/services/ai/trainingStats.ts`), `loadGovernor` (`server/services/trainingLoadService.ts`), `decisionTree` (`server/services/ai/trainingDecisionEngine.ts`), and the supplementary signals listed under TrainingContext above.

> **Not to be confused with the user-facing "Coach Insights" tab.** This module (`coachingInsights.ts`) produces the *deterministic signals* fed **into** the AI context. The single-shot AI narrative shown on the Analytics → Coach Insights tab is generated separately by `server/services/coachInsightsService.ts` (the `COACH_INSIGHTS_PROMPT` path) and **persisted** to the `analytics_results` table for instant paint and midnight recompute — see [API Reference — Coach Insights](api-reference.md#get-apiv1coach-insights) and [Integrations — recompute-analytics](integrations.md#job-types).

### RPE Trend

Compares the average RPE (Rate of Perceived Exertion) of the last 3 completed workouts against the prior 3. Requires at least 3 workouts with RPE data; returns `insufficient_data` otherwise.

- **Rising:** difference > 0.8 -- training load is increasing.
- **Stable:** difference between -0.8 and 0.8.
- **Falling:** difference < -0.8 -- training load is decreasing.

Two boolean flags are derived from the last-3 average:
- `fatigueFlag`: true when avgRPE >= 8 (high perceived effort, risk of overtraining).
- `undertrainingFlag`: true when avgRPE <= 4 (low perceived effort, stimulus may be insufficient).

### Exercise Gaps (Station Gaps)

Tracks the last trained date for each of the 8 Hyrox functional stations plus running (9 stations total): `skierg`, `sled_push`, `sled_pull`, `burpee_broad_jump`, `rowing`, `farmers_carry`, `sandbag_lunges`, `wall_balls`, and `running`.

Detection uses two strategies:
1. **Exercise sets:** Maps `exerciseName` from logged sets to station names. Running exercises (`easy_run`, `tempo_run`, `interval_run`, `long_run`) are all mapped to the `running` station.
2. **Focus text:** Scans the workout focus string for keywords via `EXERCISE_FOCUS_MAP` (e.g., "ski erg" and "ski-erg" both map to `skierg`).

Returns an array of `{ station, daysSinceLastTrained }` where `daysSinceLastTrained` is `null` if the station has never been trained.

### Plan Phase

Maps the athlete's current position within their training plan to a periodization phase:

| Phase | Condition | Description |
|-------|-----------|-------------|
| `early` | progressPct < 25% | Aerobic base building, movement pattern establishment |
| `build` | 25% <= progressPct < 60% | Progressive overload, volume accumulation |
| `peak` | 60% <= progressPct < 85% | Highest intensity, simulation workouts |
| `taper` | 85% <= progressPct < 100% | Volume reduction, maintain intensity |
| `race_week` | currentWeek >= totalWeeks | Light movement only, mental prep |

`progressPct` is calculated as `round((currentWeek / totalWeeks) * 100)`. Returns `undefined` if no active plan exists.

### Weekly Volume

Compares workout completion counts between the current week (Monday to today) and the previous full week against the user's `weeklyGoal`. Only computed when `weeklyGoal > 0`.

- **Trend:** `increasing` if thisWeek > lastWeek, `decreasing` if thisWeek < lastWeek, `stable` if equal.
- Output: `{ thisWeekCompleted, lastWeekCompleted, goal, trend }`.

### Progression Flags

Per-exercise analysis of weight and time trends across completed workouts. Each exercise receives at most one flag:

| Flag | Condition | Detail |
|------|-----------|--------|
| `plateau` | Last 3 sessions have identical weight (or time within 0.1min) | Suggests progressive overload is needed |
| `progressing` | Weight increased (or time decreased) from session 1 to session 3 of last 3 | Positive adaptation signal |
| `regressing` | Weight decreased (or time increased) from session 1 to session 3 of last 3 | May indicate fatigue or form issues |
| `new` | Only 1 session logged for this exercise | Insufficient data for trend analysis |

Weight analysis takes priority over time analysis. If a weight-based flag is found, time analysis is skipped for that exercise.

### Current Week

Calculated from the earliest plan entry date to today: `max(1, ceil((daysSinceStart + 1) / 7))`, clamped to `totalWeeks`. Falls back to week 1 if no plan entries have dates.

---

## Security

- **Consent gate:** `aiConsentCheck` (`server/middleware/aiConsent.ts`) returns 403 `AI_COACH_DISABLED` unless `user.aiCoachEnabled === true` before any AI provider call runs on the user's behalf. See [Overview](#overview).
  - Two endpoints are deliberately **not** AI routes, because their non-AI layers must serve every athlete: the [planned-session estimate](api-reference.md#nutrition-routes) and nutrition semantic search. Both check `aiCoachEnabled` **inline** instead, immediately before the provider call, so consent still governs whether any data leaves the server. Anything that calls a provider must pass through one of these two gates — middleware or inline — with no third option.
- **Budget enforcement:** `aiBudgetCheck` (`server/middleware/aibudget.ts`) runs an operator kill switch (`AI_FEATURES_ENABLED=false` -> 503 `AI_FEATURES_DISABLED`), an application-wide spend ceiling, and a per-user rolling 24h cost cap. See [Cost controls](#cost-controls).
- **Outbound requests:** both provider adapters set `redirect: "error"` on their `fetch` calls. `fetch` follows redirects by default, which would re-POST the request body — athlete prompt data — to whatever `Location` the endpoint returned, with no second [SSRF-guard](server.md#ssrf-guard) check. A chat-completions endpoint has no legitimate reason to redirect.
- **Input sanitization:** `sanitizeUserInput()` wraps all user text in XML tags and strips potential injection patterns before sending to the selected text provider. This applies to text placed in **system instructions** as well as user turns — a model weights the system instruction more heavily, so it is the last place raw input should appear. Athlete-authored custom exercise names (workout parser) and the client-supplied focused-day id (plan adjustment) are escaped and fenced like any other input.
- **Output validation:** `validateAiOutput()` checks AI text responses for safety.
- **HTML sanitization:** `sanitizeHtml()` strips HTML from all AI-generated content before database storage.
- **Content length limits:** Chat messages max 1,000 chars (request) / 50,000 chars (storage), and `role` is constrained to `user | assistant` so a client cannot seed a `system` turn into the history that is later replayed into the model's context. Coaching materials max 1,500,000 chars. Model *output* written back to the database is bounded too: the auto-coach recommendation is capped at 10,000 chars and its rationale at 2,000, matching the manual apply route so both paths agree.
- **Image inputs:** the shared image-parse schema checks the decoded leading bytes against the declared mime type (JPEG/PNG/WebP magic bytes), so a mislabelled or non-image payload is rejected before it is billed for and forwarded to the vision model.
- **RAG injection prevention:** Retrieved chunks are wrapped in `<coaching_data>` tags with instructions to treat content as data only.
- **Prompt protection:** System prompts include instructions refusing to reveal their own content.
- **Streaming transport:** The `compression` middleware is configured to skip `text/event-stream` responses so the streaming-chat output is delivered without being held in a gzip buffer (see [Server → Middleware Ordering Rationale](server.md#middleware-ordering-rationale)).

---

## Cost controls

Every provider call passes through `checkAiBudget(userId)`
(`server/services/aiUsageService.ts`), whether it came from an HTTP route, a
cron job, or a queue worker. There are two ceilings, checked in this order:

| Ceiling | Setting | Reached → | Rationale |
|---------|---------|-----------|-----------|
| Application-wide, rolling 24h across all users | `AI_GLOBAL_DAILY_LIMIT_CENTS` (unset = off) | `503 AI_GLOBAL_BUDGET_EXCEEDED` | The per-user cap bounds one athlete but not the bill — without a global ceiling, total spend scales linearly with sign-ups |
| Per user, rolling 24h | `DAILY_LIMIT_CENTS` (200 = $2.00) | `429 AI_BUDGET_EXCEEDED` | One athlete cannot exhaust the shared budget |

Spend over `WARNING_THRESHOLD_CENTS` (150 = $1.50) still allows the request but
sets the `X-AI-Budget-Warning` and `X-AI-Budget-Remaining-Cents` headers.

The global ceiling is checked first: when the deployment as a whole is over
budget, an athlete who has spent nothing must still be turned away. It returns
503 rather than 429 because it is a capacity condition the caller did not cause
and cannot clear by waiting out their own allowance.

**Why it is opt-in.** Only the operator knows the right number for their user
count and margin, and a ceiling sized too low takes AI down for everyone. Unset,
the check is skipped entirely (the previous per-user-only behaviour) and the
server logs a startup warning in production. Size it from *(active athletes ×
realistic daily spend)*, not from *(per-user cap × user count)* — the latter
assumes every athlete maxes out their $2, which none will.

**Operational notes.**

- The global total is an aggregate over the last 24h of `ai_usage_logs`, so it is
  cached in-process for 30 seconds and concurrent misses collapse into one
  query. Each replica keeps its own cache; a slightly stale total is fine.
- The global check **fails open** to the per-user cap: a transient aggregate
  query failure must not take AI down for every user. The per-user check fails
  closed, as before (`503 AI_BUDGET_UNAVAILABLE`).
- Both checks are **check-then-act** — usage is recorded after the provider call
  returns — so concurrent requests inside one rate-limit window can each pass a
  check that the sum of them exceeds. The per-route rate limits bound that
  overshoot. Closing it entirely needs a reservation written before the call and
  reconciled after, which is a change to the provider layer.
- Spend is under-counted in two known cases: a streamed response aborted before
  the provider emitted a usage chunk, and a server-side timeout after the
  provider has already billed. Embeddings are billed at a flat 150-token
  estimate.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_FEATURES_ENABLED` | `true` | Operator kill switch. `false` returns 503 `AI_FEATURES_DISABLED` for all AI routes |
| `AI_GLOBAL_DAILY_LIMIT_CENTS` | unset | Application-wide 24h AI spend ceiling in cents. Unset means no global ceiling (per-user cap only) and a startup warning in production. See [Cost controls](#cost-controls) |
| `AI_TEXT_PROVIDER` | `gemini` | Text provider for chat, text parsing, suggestions, notes, insights, and plan generation (`gemini`, `anthropic`, `openai-compatible`) |
| `AI_TEXT_MODEL` | unset | Text model for both roles wherever no role-specific override is set, on every provider (on Gemini it overrides `GEMINI_MODEL` / `GEMINI_SUGGESTIONS_MODEL`). Anthropic and OpenAI-compatible have no built-in default, so this or both role-specific overrides must be set or model resolution throws |
| `AI_TEXT_FAST_MODEL` | `AI_TEXT_MODEL`; Gemini: then `GEMINI_MODEL` | Fast parser model override |
| `AI_TEXT_REASONING_MODEL` | `AI_TEXT_MODEL`; Gemini: then `GEMINI_SUGGESTIONS_MODEL` | Coaching/planning model override |
| `AI_TEXT_REASONING_EFFORT` | `high` | Reasoning effort hint (`none`, `low`, `medium`, `high`) where supported |
| `AI_TEXT_OPENAI_COMPATIBLE_PROFILE` | `openai` | OpenAI-compatible profile (`openai`, `xai`, `groq`, `together`, `openrouter`, `deepseek`, `custom`) for base URL and key lookup |
| `AI_TEXT_BASE_URL` | profile default | Overrides the OpenAI-compatible base URL (required for `custom`) |
| `AI_TEXT_API_KEY` | profile/provider key | Overrides the API key for the active non-Gemini provider |
| `OPENAI_API_KEY` / `XAI_API_KEY` / `GROQ_API_KEY` / `TOGETHER_API_KEY` / `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` | unset | Per-profile API keys for OpenAI-compatible providers |
| `ANTHROPIC_API_KEY` | unset | API key for the Anthropic text provider |
| `GEMINI_API_KEY` | required for Gemini text, RAG, image parse | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | Gemini fast/parser model |
| `GEMINI_SUGGESTIONS_MODEL` | `gemini-3.1-pro-preview` | Gemini reasoning model for chat, suggestions, and plan generation |
| `GEMINI_VISION_MODEL` | `gemini-2.5-flash` | Gemini model for photo-to-workout parsing and nutrition meal-photo / label-scan parsing |
| `VECTOR_DATABASE_URL` | Falls back to `DATABASE_URL` | Separate pgvector database connection |
| `RAG_CHUNK_SIZE` | 600 | Characters per document chunk |
| `RAG_CHUNK_OVERLAP` | 100 | Character overlap between adjacent chunks |

---

## Key Files

| File | Purpose |
|------|---------|
| `server/ai/providers/` | Text AI provider layer (Gemini, Anthropic, OpenAI-compatible) |
| `server/ai/retry.ts` | Provider-neutral `retryWithBackoff()` / `withTimeout()` |
| `server/ai/circuitBreaker.ts` | Shared AI provider circuit breaker, persisted in `server_runtime_cache` |
| `server/ai/geminiSdk.ts` | Lazy `GoogleGenAI` client factory (`getAiClient()`) |
| `server/gemini/client.ts` | Embedding generation (with its process-local cache), vision model name, usage tracking; re-exports `getAiClient`, `retryWithBackoff`, `withTimeout`, `isRetryableError` |
| `server/gemini/exerciseParser.ts` + `server/gemini/exerciseParser/` | Free-text and photo-to-workout structured exercise parsing |
| `server/gemini/chatService.ts` | Chat and streaming chat through the text provider facade |
| `server/gemini/suggestionService.ts` | Workout suggestion generation |
| `server/gemini/types.ts` | TrainingContext type definition |
| `server/services/aiContextService.ts` | Shared context builder for AI endpoints |
| `server/services/ai/` | Training context + coaching insights modules |
| `server/services/aiModificationGuard.ts` | Suppresses repeated fatigue/volume reductions on the same workout |
| `server/services/aiSafety.ts` | Red-flag symptom and HR-medication detection / escalation |
| `server/services/ragService.ts` | Document chunking, embedding, and re-embedding |
| `server/services/ragRetrieval.ts` | Vector search and fallback retrieval logic |
| `server/services/coachService.ts` | Auto-coach pipeline |
| `server/services/planGenerationService.ts` | AI training plan generation |
| `server/services/chatIntentService.ts` + `server/services/planAdjustmentService.ts` | Chat plan-edit intent gate and plan-adjustment proposals |
| `server/middleware/aiConsent.ts` | `aiCoachEnabled` consent gate (403 `AI_COACH_DISABLED`) |
| `server/middleware/aibudget.ts` | AI kill switch + rolling 24h budget enforcement |
| `server/prompts.ts` + `server/prompts/` | All prompt templates and context formatters |
