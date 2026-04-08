# Codebase Review — April 8, 2026

## Review passes executed
1. **Pass 1 (System topology):** boot path, middleware chain, route registration order, env validation, auth.
2. **Pass 2 (Security):** authn/authz boundaries, CSRF/CORS/CSP, idempotency, token handling, external callback safety.
3. **Pass 3 (Performance):** hot-path DB calls, cache behavior, external API retries/timeouts, memory growth vectors.
4. **Pass 4 (Maintainability/Scalability):** coupling, implicit contracts, operational failure modes, horizontal scaling constraints.
5. **Pass 5 (Integrations):** Gemini and Strava reliability/guardrails, timeout+fallback coverage, retriable vs non-retriable behavior.

---

## 1) Architecture & Design Patterns

### [Severity Level]: High
**File/Location:** `server/routes.ts` and `server/middleware/idempotency.ts`

**The Issue:**
Idempotency middleware is mounted globally on `/api/v1` *before* route-level `isAuthenticated` handlers run. The middleware itself expects auth to already be resolved (`getUserId(req)`), and silently bypasses idempotency on failure. Net effect: the idempotency system appears enabled but is effectively non-functional for most protected mutating routes. This creates hidden behavior and breaks the offline replay contract.

**The Fix:**
Move idempotency execution to run after auth for mutating, authenticated routes. A clean fix is to compose route guards in a shared helper.

```ts
// server/routeGuards.ts
import type { RequestHandler } from "express";
import { isAuthenticated } from "./clerkAuth";
import { idempotencyMiddleware } from "./middleware/idempotency";

export const protectedMutationGuards: RequestHandler[] = [
  isAuthenticated,
  (req, res, next) => {
    void idempotencyMiddleware(req, res, next);
  },
];
```

```ts
// server/routes/ai.ts (example)
import { protectedMutationGuards } from "../routeGuards";

router.post(
  "/api/v1/chat/message",
  ...protectedMutationGuards,
  rateLimiter("chatMessage", 20),
  validateBody(insertChatMessageSchema),
  asyncHandler(async (req, res) => {
    // unchanged handler
  }),
);
```

---

### [Severity Level]: Medium
**File/Location:** `server/routes.ts`

**The Issue:**
Cross-cutting concerns (CSRF, idempotency, auth) are split between global app middleware and per-route middleware conventions. This creates brittle implicit ordering contracts that are easy to break during feature work.

**The Fix:**
Introduce explicit route composition primitives (`protectedRoute`, `protectedMutationRoute`) and remove global idempotency mount from `registerRoutes`.

```ts
// server/routeFactory.ts
import type { RequestHandler } from "express";
import { isAuthenticated } from "./clerkAuth";
import { idempotencyMiddleware } from "./middleware/idempotency";

export const protectedRoute = (handlers: RequestHandler[]): RequestHandler[] => [
  isAuthenticated,
  ...handlers,
];

export const protectedMutationRoute = (handlers: RequestHandler[]): RequestHandler[] => [
  isAuthenticated,
  (req, res, next) => { void idempotencyMiddleware(req, res, next); },
  ...handlers,
];
```

---

## 2) Security & Vulnerabilities

### [Severity Level]: High
**File/Location:** `server/strava.ts` (`STATE_SECRET` fallback)

**The Issue:**
If `STRAVA_STATE_SECRET` is missing, the app generates an in-memory random secret at boot. On restart or in multi-instance deployments, OAuth callbacks can fail state verification unpredictably. This is primarily reliability, but it also weakens security posture by allowing misconfigured production to run with unstable CSRF state protection.

**The Fix:**
Fail hard in production if `STRAVA_STATE_SECRET` is absent.

```ts
// server/env.ts
STRAVA_STATE_SECRET: z.string().min(32).optional(),
```

```ts
// server/strava.ts
if (env.NODE_ENV === "production" && !env.STRAVA_STATE_SECRET) {
  throw new Error("STRAVA_STATE_SECRET is required in production");
}
const STATE_SECRET = env.STRAVA_STATE_SECRET ?? crypto.randomBytes(32).toString("hex");
```

---

### [Severity Level]: Medium
**File/Location:** `server/index.ts` (CORS origin callback)

**The Issue:**
CORS currently allows requests with no `Origin` header (`!origin`) while also allowing credentials. This is often intentional for same-origin/server-server calls, but in hardened deployments it broadens accepted traffic classes and can mask cross-channel abuse patterns.

**The Fix:**
Gate `!origin` allowance behind explicit env flag and default-deny in production.

```ts
const allowNoOrigin = env.NODE_ENV !== "production";

app.use(cors({
  origin: (origin, cb) => {
    if ((allowNoOrigin && !origin) || (origin && allowedOrigins.has(origin))) {
      return cb(null, true);
    }
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
```

---

## 3) Performance & Optimization

### [Severity Level]: High
**File/Location:** `server/clerkAuth.ts` (`isAuthenticated` → `ensureUserExists`)

**The Issue:**
Every authenticated request triggers `ensureUserExists`, which performs at least one DB read and occasionally a Clerk API call. This is an avoidable hot-path overhead on every API request and becomes expensive under load.

**The Fix:**
Memoize user existence check for short TTL and shift full sync to async/background reconciliation.

```ts
const userSeenCache = new Map<string, number>();
const USER_SEEN_TTL_MS = 5 * 60_000;

async function ensureUserExistsFast(clerkUserId: string): Promise<void> {
  const now = Date.now();
  const seenAt = userSeenCache.get(clerkUserId);
  if (seenAt && now - seenAt < USER_SEEN_TTL_MS) return;

  const existing = await storage.users.getUser(clerkUserId);
  if (!existing) {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    await storage.users.upsertUser({
      id: clerkUserId,
      email: clerkUser.emailAddresses?.[0]?.emailAddress || null,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      profileImageUrl: clerkUser.imageUrl,
    });
  }

  userSeenCache.set(clerkUserId, now);
}
```

---

### [Severity Level]: Medium
**File/Location:** `server/services/ragService.ts` (`ragCache`)

**The Issue:**
`ragCache` is a process-wide `Map` keyed by raw query text and user id with TTL but no max-size eviction. High-cardinality queries can cause unbounded memory growth during TTL windows.

**The Fix:**
Use bounded LRU semantics with TTL.

```ts
const MAX_RAG_CACHE_ENTRIES = 2_000;

function setRagCache(key: string, chunks: string[]) {
  if (ragCache.size >= MAX_RAG_CACHE_ENTRIES) {
    const oldestKey = ragCache.keys().next().value as string | undefined;
    if (oldestKey) ragCache.delete(oldestKey);
  }
  ragCache.set(key, { chunks, at: Date.now() });
}
```

Then replace direct `ragCache.set(...)` calls with `setRagCache(...)`.

---

## 4) Maintainability & Scalability

### [Severity Level]: Medium
**File/Location:** `server/routeUtils.ts` (`MemoryStore` in express-rate-limit)

**The Issue:**
Rate limiting uses in-memory store. This is fine for one instance, but silently fails to enforce global limits in horizontal scaling (multi-pod/instance), creating inconsistent behavior across environments.

**The Fix:**
Abstract limiter store behind env-driven adapter and use Redis in production.

```ts
import { RedisStore } from "rate-limit-redis";

const store = env.NODE_ENV === "production"
  ? new RedisStore({ sendCommand: (...args: string[]) => redisClient.sendCommand(args) })
  : new MemoryStore();

rateLimit({
  windowMs,
  max: maxRequests,
  store,
  // ...
});
```

---

### [Severity Level]: Low
**File/Location:** `server/index.ts`

**The Issue:**
Server starts listening before startup dependencies finish. Health endpoint handles readiness, which is good, but this pattern can still increase operational complexity (traffic reaches node before critical subsystems are ready unless orchestrator strictly honors readiness endpoint).

**The Fix:**
Either (a) keep current model but enforce strict readiness probes in deployment docs, or (b) bind listener after startup completes.

```ts
await runStartupMaintenance(storage);
await startQueue();
startCron(storage);
await registerRoutes(httpServer, app);

await new Promise<void>((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen({ port, host: "0.0.0.0" }, resolve);
});
```

---

## 5) External Integrations

### [Severity Level]: Medium
**File/Location:** `server/gemini/client.ts` (`retryWithBackoff`)

**The Issue:**
Gemini retry strategy uses pure exponential backoff without jitter. Under upstream partial outages, synchronized retries can amplify contention (retry storm).

**The Fix:**
Add bounded jitter and optionally honor provider retry hints.

```ts
const jitter = Math.floor(Math.random() * 250);
const delay = baseDelayMs * 2 ** attempt + jitter;
await new Promise((resolve) => setTimeout(resolve, delay));
```

(Prefer crypto-based jitter helper if lint/security rules require it.)

---

### [Severity Level]: Medium
**File/Location:** `server/strava.ts` (`handleStravaCallback`)

**The Issue:**
Strava callback token exchange has timeout but no retry wrapper for 429/5xx, unlike other Strava calls. This asymmetry creates user-visible OAuth flakiness during transient provider issues.

**The Fix:**
Wrap token exchange with `retryWithJitter` and `RetryableHttpError` classification, same as other Strava interactions.

```ts
const tokenResponse = await retryWithJitter(async () => {
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
  });

  if (r.status === 429 || r.status >= 500) {
    throw new RetryableHttpError(r.status, parseRetryAfter(r.headers.get("retry-after")));
  }
  return r;
}, { label: "strava.oauthToken", retries: 3 });
```

---

## Priority order to address
1. **Fix idempotency middleware ordering (High).**
2. **Enforce production requirement for `STRAVA_STATE_SECRET` (High).**
3. **Remove auth hot-path DB sync overhead (High).**
4. **Bound in-memory caches and make rate limiter distributed-ready (Medium).**
5. **Harden external retry behavior consistency (Medium).**
