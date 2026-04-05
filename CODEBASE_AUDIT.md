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

### [Severity Level]: Medium
**File/Location:** `server/routes/workouts.ts` (module-level orchestration)

**The Issue:**
`workouts.ts` is still carrying too many responsibilities (transport parsing, validation edge-cases, business orchestration, and response shaping). This weakens separation of concerns and makes transactional behavior harder to reason about as features grow.

**The Fix:**
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

// server/useCases/workoutUseCases.ts
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

### [Severity Level]: High
**File/Location:** `client/src/lib/offlineQueue.ts` + mutation routes (no idempotency enforcement found server-side)

**The Issue:**
Offline replay sends `X-Idempotency-Key`, but server endpoints do not enforce idempotency. Network retries can duplicate state-changing writes.

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

### [Severity Level]: Medium
**File/Location:** `server/routes/ai.ts` (`/api/v1/chat/stream`) and `server/gemini/chatService.ts`

**The Issue:**
On SSE disconnect, the API stops writing to client but does not cancel upstream Gemini generation explicitly.

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

### [Severity Level]: Medium
**File/Location:** `server/routes/workouts.ts` (`POST /api/v1/custom-exercises`)

**The Issue:**
This endpoint uses inline `safeParse` + custom error shape while most routes use `validateBody(...)`. API validation contracts are inconsistent.

**Why it matters:**
Clients must special-case error handling; observability and contract testing become fragmented.

**The Fix:**
Adopt shared validation middleware here as well.

```ts
const createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true });

router.post(
  "/api/v1/custom-exercises",
  isAuthenticated,
  rateLimiter("customExercise", 20),
  validateBody(createCustomExerciseSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { name, category } = req.body;
    const exercise = await storage.users.upsertCustomExercise({
      userId,
      name: name.trim(),
      category: category || "conditioning",
    });
    res.json(exercise);
  }),
);
```

---

## 5) External Integrations

### [Severity Level]: Medium
**File/Location:** `server/strava.ts` (`handleStravaSync`)

**The Issue:**
`skipped` is incremented twice for each already-imported activity.

```ts
if (existingStravaIds.has(String(activity.id))) {
  skipped++;
  skipped++;
  continue;
}
```

**Why it matters:**
Sync metrics become wrong (`imported/skipped/total`), which degrades UX trust and operational visibility.

**The Fix:**
Increment once.

```ts
if (existingStravaIds.has(String(activity.id))) {
  skipped++;
  continue;
}
```

### [Severity Level]: Medium
**File/Location:** `server/emailScheduler.ts` (`runEmailCronJob`)

**The Issue:**
Job enqueue calls are fire-and-forget and not awaited, but function still reports optimistic success counts.

**Why it matters:**
When queue sends fail, reporting becomes inaccurate and jobs may silently drop.

**The Fix:**
Await enqueue operations with `Promise.allSettled` and report fulfilled count only.

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

1. **High:** server-side idempotency enforcement for mutating endpoints.
2. **Medium:** abort propagation for AI SSE streaming.
3. **Medium:** fix Strava skipped-counter bug.
4. **Medium:** await email job enqueues and correct reporting.
5. **Medium:** normalize custom-exercise validation contract.
6. **Medium:** extract workout orchestration to use-case layer.
