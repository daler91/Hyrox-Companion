# Hyrox Companion — Deep Codebase Audit (Updated Multi‑Pass Findings)

## Review method

I re-ran a fresh multi-pass review across:

1. Architecture & design boundaries
2. Security & abuse posture
3. Performance bottlenecks and waste
4. Maintainability/scalability drift
5. External integration resilience

---

## 1) Architecture & Design Patterns

### [Severity Level]: Medium — RESOLVED (2026-05-29)
**File/Location:** `server/routes/workouts/*` + `server/services/workoutUseCases.ts` + `server/services/workoutService/reparse.ts`

**Status:** The single-file `server/routes/workouts.ts` no longer exists. Routes are now split across `server/routes/workouts/workoutsCrud.routes.ts`, `workoutsAi.routes.ts`, `workoutsExport.routes.ts`, `workoutsMigration.routes.ts`, and `workoutsTimeline.routes.ts`. The use-case layer exists (`workoutUseCases.ts` exports `createWorkout`/`updateWorkoutUseCase`), and reparse orchestration was extracted into `server/services/workoutService/reparse.ts`.

**Resolved (PR #1291):** Orchestration for the reparse, image-parse, and batch-reparse handlers was extracted into `server/services/parseWorkoutUseCases.ts` (`reparseWorkoutUseCase` / `reparseWorkoutFromImageUseCase` / `batchReparseWorkoutsUseCase`). The handlers in `workoutsAi.routes.ts` are now thin validate-and-delegate wrappers that map a `not_found` / `parse_failed` / `ok` outcome to HTTP.

**Original issue:**
`workouts.ts` was carrying too many responsibilities (transport parsing, validation edge-cases, business orchestration, and response shaping). This weakened separation of concerns and made transactional behavior harder to reason about as features grew.

**The Fix (target state, now partly in place):**
Move route-independent orchestration into a use-case/service layer and keep route handlers thin.

```ts
// server/routes/workouts.ts
router.post(
  "/api/v1/workouts",
  isAuthenticated,
  rateLimiter("workout", 40),
  validateBody(createWorkoutRouteSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const result = await workoutUseCases.createWorkout({
      userId,
      payload: req.body,
    });
    res.json(result);
  }),
);

// server/services/workoutUseCases.ts  (actual location)
export async function createWorkout(input: {
  userId: string;
  payload: CreateWorkoutRoutePayload;
}) {
  const { exercises, ...workoutData } = input.payload;
  return createWorkoutAndScheduleCoaching(
    workoutData as InsertWorkoutLog,
    exercises as ParsedExercise[] | undefined,
    input.userId,
  );
}
```

---

## 2) Security & Vulnerabilities

### [Severity Level]: High — RESOLVED
**File/Location:** `server/middleware/idempotency.ts` + `server/routeGuards.ts` + every mutating route

**Status:** Fixed. `idempotencyMiddleware` is in place, backed by a durable
`idempotency_keys` table (`server/storage/idempotency.ts`) with a daily
`cleanupExpired` cron. `protectedMutationGuards` composes it with
`isAuthenticated` and is applied to every `POST`/`PUT`/`PATCH`/`DELETE` route
across `server/routes/*.ts` and `server/strava.ts`. Retried requests with the
same `(userId, X-Idempotency-Key)` now replay the cached 2xx response instead
of re-executing the handler.

**Original issue:**
Offline replay sends `X-Idempotency-Key`, but server endpoints did not enforce idempotency. Network retries could duplicate state-changing writes.

**Why it matters:**
This is both a data integrity problem (duplicate workout logs/side effects) and an abuse amplification vector.

**The Fix:**
Implement server-side idempotency middleware backed by durable storage.

```ts
// server/middleware/idempotency.ts
export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-idempotency-key");
  if (!key || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const userId = (req as Request & { auth?: { userId?: string } }).auth?.userId ?? "anon";
  const scope = `${userId}:${req.method}:${req.path}:${key}`;

  const prior = await idempotencyStore.get(scope); // Postgres/Redis
  if (prior) return res.status(prior.status).json(prior.body);

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    void idempotencyStore.set(scope, { status: res.statusCode || 200, body }, 24 * 60 * 60);
    return originalJson(body);
  }) as typeof res.json;

  next();
}
```

---

## 3) Performance & Optimization

### [Severity Level]: Medium — RESOLVED
**File/Location:** `server/routes/ai.ts` (`/api/v1/chat/stream`) and `server/gemini/chatService.ts`

**Status:** Fixed. The `/chat/stream` handler creates an `AbortController`
bridged to `req.on("close")` and threads `controller.signal` through to
`streamChatWithCoach`, which forwards it to Gemini's
`generateContentStream({ abortSignal: signal })`. The for-await loop also
checks `controller.signal.aborted` each iteration and breaks early, so both
the Gemini request and the local loop unwind promptly on client disconnect.

**Original issue:**
On SSE disconnect, the API stops writing to client but did not cancel upstream Gemini generation explicitly.

**Why it matters:**
Uncanceled generation can burn tokens, increase latency pressure, and waste compute under churn/disconnect scenarios.

**The Fix:**
Thread an `AbortSignal` from route to Gemini stream call and abort on `req.close`.

```ts
// server/routes/ai.ts
const controller = new AbortController();
req.on("close", () => controller.abort());

const stream = streamChatWithCoach(
  input.message,
  input.history,
  aiContext.trainingContext,
  aiContext.coachingMaterials,
  aiContext.retrievedChunks,
  controller.signal,
);

// server/gemini/chatService.ts (signature)
export async function* streamChatWithCoach(...args: unknown[], signal?: AbortSignal): AsyncGenerator<string> {
  const stream = await getAiClient().models.generateContentStream({
    model: GEMINI_SUGGESTIONS_MODEL,
    config: { systemInstruction: systemPrompt, thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } },
    contents: messages,
    signal,
  });
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    if (chunk.text) yield validateAiOutput(chunk.text);
  }
}
```

---

## 4) Maintainability & Scalability

### [Severity Level]: Medium — RESOLVED
**File/Location:** `server/routes/workouts/workoutsCrud.routes.ts` (`POST /api/v1/custom-exercises`)

**Status:** Fixed. The endpoint is now registered with `protectedPost(router, "/api/v1/custom-exercises", { limiter: rateLimiter("customExercise", 20), middleware: [validateBody(createCustomExerciseSchema)] }, ...)` (`server/routes/workouts/workoutsCrud.routes.ts:87`). The schema lives in `server/routes/workouts/shared.ts:8` as `createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true })`. The endpoint now uses the same shared validation middleware as the rest of the routes, and the inline `safeParse` is gone.

**Original issue:**
This endpoint used inline `safeParse` + custom error shape while most routes used `validateBody(...)`, making API validation contracts inconsistent.

**The Fix (now in place):**
```ts
const createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true });

protectedPost(
  router,
  "/api/v1/custom-exercises",
  { limiter: rateLimiter("customExercise", 20), middleware: [validateBody(createCustomExerciseSchema)] },
  async (req, res) => {
    const userId = getUserId(req);
    const { name, category } = req.body;
    const exercise = await storage.users.upsertCustomExercise({
      userId,
      name: name.trim(),
      category: category || "conditioning",
    });
    res.json(exercise);
  },
);
```

---

## 5) External Integrations

### [Severity Level]: Medium — RESOLVED (verified already correct)
**File/Location:** `server/strava.ts` (`handleStravaSync`)

**Status:** No code change required. Verified at `server/strava.ts:315-322`: `skipped` is already
incremented exactly once per already-imported activity. This audit item was stale.

### [Severity Level]: Medium — RESOLVED
**File/Location:** `server/emailScheduler.ts` (`runEmailCronJob`)

**Status:** Fixed. `server/emailScheduler.ts:154-191` now collects each `sendJobNoRetry(...)` call into an `ops: Promise<unknown>[]` array, awaits the batch with `Promise.allSettled`, and reports the fulfilled count as `emailsSent` while logging individual rejections. Reporting now reflects actual queue acceptance instead of fire-and-forget optimism.

**Original issue:**
Job enqueue calls were fire-and-forget and not awaited, but the function still reported optimistic success counts.

**The Fix (now in place):**
```ts
const ops: Promise<unknown>[] = [];
for (const user of usersToCheck) {
  if (isMonday) ops.push(queue.send("send-weekly-summary", { userId: user.id }));
  ops.push(queue.send("send-missed-reminder", { userId: user.id }));
}

const settled = await Promise.allSettled(ops);
const success = settled.filter((r) => r.status === "fulfilled").length;
const failed = settled.length - success;

return {
  usersChecked: usersToCheck.length,
  emailsSent: success,
  details: [`Enqueued ${success}/${settled.length}`, `Failed: ${failed}`],
};
```

---

## Priority implementation order

1. ~~**High:** server-side idempotency enforcement for mutating endpoints.~~ — RESOLVED
2. ~~**Medium:** abort propagation for AI SSE streaming.~~ — RESOLVED
3. ~~**Medium:** fix Strava skipped-counter bug.~~ — RESOLVED (verified already correct)
4. ~~**Medium:** await email job enqueues and correct reporting.~~ — RESOLVED
5. ~~**Medium:** normalize custom-exercise validation contract.~~ — RESOLVED
6. ~~**Medium:** extract reparse/image-parse/batch-reparse orchestration into a `parseWorkoutUseCases.ts` so `workoutsAi.routes.ts` handlers shrink to validate-and-delegate.~~ — RESOLVED (PR #1291)
