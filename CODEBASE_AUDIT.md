# Hyrox Companion — Deep Codebase Audit (Multi-Pass)

## Audit Method

I reviewed this repository in multiple passes so findings are structural (not lint-level):

1. **System pass**: request lifecycle, middleware, route registration, service/storage layering.
2. **Security pass**: auth boundaries, CSRF/CORS posture, token handling, abuse controls, sensitive logging.
3. **Performance pass**: expensive endpoints, queue workers, AI/RAG concurrency, DB write/read patterns.
4. **Scalability/maintainability pass**: coupling, transactional integrity, consistency of validation/error contracts.
5. **Integration pass**: Strava + Gemini + queue reliability (timeouts, idempotency, backpressure).

---

## 1) Architecture & Design Patterns

### [Severity Level]: Medium

**File/Location:** `server/routes/workouts.ts`, `server/routes/plans.ts`, `server/routes/ai.ts`

**The Issue:**
Route modules are doing orchestration, validation, storage calls, queueing, and business decisions in one place. This increases coupling and makes transaction boundaries and retries inconsistent across endpoints.

**The Fix:**
Move orchestration into a service-layer use-case function and keep routes thin.

```ts
// server/routes/workouts.ts
router.post(
  "/api/v1/workouts",
  isAuthenticated,
  rateLimiter("workout", 40),
  validateBody(createWorkoutRequestSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const result = await workoutUseCases.createWorkoutAndScheduleCoaching({
      userId,
      ...req.body,
    });
    res.status(201).json(result);
  }),
);

// server/useCases/workoutUseCases.ts
export async function createWorkoutAndScheduleCoaching(input: CreateWorkoutInput) {
  return db.transaction(async (tx) => {
    const workout = await workoutRepo.create(tx, input);
    await coachingRepo.markPendingIfEnabled(tx, input.userId);
    await outboxRepo.enqueue(tx, "auto-coach", { userId: input.userId, workoutId: workout.id });
    return workout;
  });
}
```

### [Severity Level]: Medium

**File/Location:** `server/routes/*.ts` (mixed use of `validateBody` vs inline `safeParse`)

**The Issue:**
Validation and error-shaping are inconsistent by route. Some endpoints use middleware, others parse inline and return custom payloads. This fragments client contract guarantees and complicates monitoring.

**The Fix:**
Use one route factory that standardizes: auth → rate limit → schema validation → handler → error payload format.

```ts
export function authedJsonRoute<T extends z.ZodTypeAny>(opts: {
  schema: T;
  limiter?: RequestHandler;
  handler: (req: Request<unknown, unknown, z.infer<T>>, res: Response) => Promise<void>;
}) {
  return [
    isAuthenticated,
    opts.limiter,
    validateBody(opts.schema),
    asyncHandler(opts.handler),
  ].filter(Boolean) as RequestHandler[];
}
```

---

## 2) Security & Vulnerabilities

### [Severity Level]: High

**File/Location:** `server/index.ts` (cookie auth + mutation endpoints)

**The Issue:**
The app relies on cookie-based auth and permissive credentialed requests but does not enforce explicit CSRF tokens on state-changing routes. CORS is not a CSRF control.

**The Fix:**
Add CSRF protection for non-idempotent methods and expose a token endpoint for the SPA.

```ts
import cookieParser from "cookie-parser";
import csrf from "csurf";

app.use(cookieParser());
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
  },
});

app.get("/api/v1/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.use("/api/v1", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  return csrfProtection(req, res, next);
});
```

### [Severity Level]: Medium

**File/Location:** `server/clerkAuth.ts` (`app.set("trust proxy", 1)`), `server/routeUtils.ts` (IP fallback keying)

**The Issue:**
`trust proxy` is hardcoded to `1`; in misconfigured or changing deployments this can make `req.ip` derived from untrusted forwarding headers, weakening abuse controls.

**The Fix:**
Drive proxy trust via validated env config and use user-id keys whenever authenticated.

```ts
// env.ts
TRUST_PROXY: (z.union([z.literal("0"), z.literal("1"), z.literal("loopback")]).default("1"),
  // clerkAuth.ts
  app.set("trust proxy", env.TRUST_PROXY === "0" ? false : env.TRUST_PROXY));

// routeUtils.ts
keyGenerator: (req) => {
  const userId = (req as AuthenticatedRequest).auth?.userId;
  if (userId) return `${category}:user:${userId}`;
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${category}:ip:${ip}`;
};
```

### [Severity Level]: Low

**File/Location:** `server/clerkAuth.ts` (auth failure debug logging)

**The Issue:**
On auth failure, logs include cookie key names. This can leak internal cookie inventory to logs and observability systems where access is wider than production app access.

**The Fix:**
Log only coarse auth indicators.

```ts
logger.debug(
  {
    path: req.path,
    hasCookie: Boolean(req.headers.cookie),
    hasAuthHeader: Boolean(req.headers.authorization),
    clerkUserIdPresent: Boolean(auth?.userId),
  },
  "Clerk auth failed",
);
```

---

## 3) Performance & Optimization

### [Severity Level]: High

**File/Location:** `server/services/ragService.ts` (`reembedAllMaterials`)

**The Issue:**
`Promise.allSettled(materials.map(embedCoachingMaterial))` is unbounded concurrency. Large tenants can create heavy burst traffic to Gemini + DB.

**The Fix:**
Bound concurrency with `p-limit` and add progress telemetry.

```ts
import pLimit from "p-limit";

const limit = pLimit(3);
const results = await Promise.allSettled(
  materials.map((m) => limit(() => embedCoachingMaterial(m))),
);
```

### [Severity Level]: Medium

**File/Location:** `server/services/ragService.ts` (`getRagStatus`)

**The Issue:**
`getRagStatus` performs a live embedding probe (`generateEmbedding("test")`) in request path. This endpoint becomes expensive under frequent UI polling.

**The Fix:**
Cache provider health for a short TTL.

```ts
let cachedEmbeddingHealth: { value: EmbeddingHealth; at: number } | null = null;
const TTL_MS = 5 * 60_000;

async function getEmbeddingHealth(): Promise<EmbeddingHealth> {
  if (cachedEmbeddingHealth && Date.now() - cachedEmbeddingHealth.at < TTL_MS) {
    return cachedEmbeddingHealth.value;
  }
  const value = await probeEmbeddingProvider();
  cachedEmbeddingHealth = { value, at: Date.now() };
  return value;
}
```

### [Severity Level]: Medium

**File/Location:** `server/queue.ts` (`auto-coach`, `embed-coaching-material`, `send-*` workers)

**The Issue:**
Workers process each polled batch with `Promise.all`, causing in-batch bursts. Under backlog spikes, this can flood DB/external APIs.

**The Fix:**
Limit in-batch parallelism and tune queue polling.

```ts
import pLimit from "p-limit";
const limit = pLimit(2);

await queue.work("auto-coach", async (jobs) => {
  await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const { userId } = job.data as { userId: string };
        await triggerAutoCoach(userId);
      }),
    ),
  );
});
```

---

## 4) Maintainability & Scalability

### [Severity Level]: High

**File/Location:** `server/routes/workouts.ts` (`POST /api/v1/workouts`)

**The Issue:**
The workout write happens before `updateIsAutoCoaching`. If flag update throws, API can return an error after data was already committed. This creates retry/duplication risk and confusing UX.

**The Fix:**
Wrap workflow in transaction + outbox pattern.

```ts
await db.transaction(async (tx) => {
  const workout = await workoutRepo.create(tx, payloadWithUser);

  if (user.aiCoachEnabled) {
    await userRepo.updateIsAutoCoaching(tx, userId, true);
    await outboxRepo.enqueue(tx, "auto-coach", { userId, workoutId: workout.id });
  }

  return workout;
});
```

### [Severity Level]: Medium

**File/Location:** `server/storage/index.ts` (manual delegation of all IStorage methods)

**The Issue:**
The facade delegates dozens of methods manually. Adding/modifying storage methods creates high boilerplate and mechanical drift risk.

**The Fix:**
Group by domain interfaces and compose typed domain services instead of a giant hand-delegated class.

```ts
export interface Storage {
  users: UserStorage;
  workouts: WorkoutStorage;
  plans: PlanStorage;
  timeline: TimelineStorage;
  analytics: AnalyticsStorage;
  coaching: CoachingStorage;
}

export const storage: Storage = {
  users: new UserStorage(),
  workouts: new WorkoutStorage(),
  plans: new PlanStorage(),
  timeline: new TimelineStorage(new WorkoutStorage()),
  analytics: new AnalyticsStorage(),
  coaching: new CoachingStorage(),
};
```

---

## 5) External Integrations

### [Severity Level]: High

**File/Location:** `server/strava.ts` (`handleStravaSync`), `shared/schema/tables.ts` (`workout_logs.stravaActivityId`)

**The Issue:**
Deduplication is application-side only (`getExistingStravaActivityIds`). Without a DB uniqueness constraint, concurrent sync requests can insert duplicate workouts for the same activity.

**The Fix:**
Enforce uniqueness in DB and use conflict-safe insert.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_logs_user_strava_unique
ON workout_logs (user_id, strava_activity_id)
WHERE strava_activity_id IS NOT NULL;
```

```ts
await db
  .insert(workoutLogs)
  .values(workoutsToImport)
  .onConflictDoNothing({ target: [workoutLogs.userId, workoutLogs.stravaActivityId] });
```

### [Severity Level]: Medium

**File/Location:** `server/gemini/client.ts` (`retryWithBackoff`, `generateEmbeddings`)

**The Issue:**
Retry logic exists, but no circuit breaker/backpressure state exists for prolonged provider outages. During outages, repeated retries can amplify system latency.

**The Fix:**
Add a simple circuit breaker and fail fast while degraded.

```ts
if (breaker.isOpen()) {
  throw new Error("Gemini temporarily unavailable");
}

try {
  const result = await retryWithBackoff(fn, label);
  breaker.onSuccess();
  return result;
} catch (err) {
  breaker.onFailure(err);
  throw err;
}
```

### [Severity Level]: Medium

**File/Location:** `server/strava.ts` (`refreshStravaToken`, `handleStravaSync`)

**The Issue:**
External Strava calls have timeout protection, but no retry strategy for transient 5xx/429 errors. This hurts reliability during provider hiccups.

**The Fix:**
Use bounded retries with jitter only for retryable responses.

```ts
const data = await retryWithJitter(
  async () => {
    const res = await fetch(url, opts);
    if (res.status === 429 || res.status >= 500) throw new RetryableHttpError(res.status);
    if (!res.ok) throw new Error(`Strava call failed: ${res.status}`);
    return res.json();
  },
  { retries: 3, minDelayMs: 300, maxDelayMs: 2000 },
);
```

---

## Priority Remediation Order

1. **High:** CSRF protection for state-changing routes.
2. **High:** Transaction + outbox around workout creation + coaching flag/job.
3. **High:** DB uniqueness for `(user_id, strava_activity_id)`.
4. **High:** Bounded concurrency for re-embedding and queue workers.
5. **Medium:** Standardize route validation/error contracts.
6. **Medium:** Add integration resilience patterns (circuit breaker + retry policy).
