# Codebase Analysis & Improvement Recommendations

## Overview

**Hyrox-Companion** is a production-grade, full-stack TypeScript monorepo (~15,000 LOC) for Hyrox race training. It features AI coaching (Gemini), Strava integration, workout logging with voice input, analytics dashboards, and training plan management.

| Component | Stack | LOC |
|-----------|-------|-----|
| Frontend | React 18, Vite, TanStack Query, shadcn/ui, Tailwind CSS 4 | ~6,500 |
| Backend | Express, Drizzle ORM, PostgreSQL, Clerk auth | ~4,900 |
| Shared | Zod schemas, Drizzle table definitions | ~400 |
| Tests | Vitest (44 suites), Cypress (10 E2E suites) | ~3,500 |

**Architecture:** Clean service-layer pattern (routes → services → storage interface → Drizzle ORM). Well-defined `IStorage` interface enables testability. Shared Zod schemas enforce type safety across the stack.

---

## What's Done Well

- **Type safety:** Strict TypeScript throughout with Drizzle + Zod schema generation
- **Auth & security:** Clerk JWT, Helmet CSP, encrypted Strava tokens, rate limiting, non-root Docker
- **Testing:** 80% coverage thresholds, 44 unit test suites, 10 Cypress E2E suites
- **CI/CD:** GitHub Actions for tests, SonarQube, Cypress Cloud, Trivy container scanning
- **Database design:** Proper indexing (composite indexes on hot paths), cascading deletes, check constraints
- **Storage abstraction:** `IStorage` interface decouples routes from database implementation
- **Monitoring:** Sentry integration for error tracking

---

## Recommended Improvements

### 1. Add ESLint + Prettier (High Impact, Low Effort)

**Problem:** No linter or formatter is configured. TypeScript's `tsc` catches type errors but misses code quality issues (unused variables, unreachable code, consistent imports, etc.).

**Recommendation:**
```bash
pnpm add -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-config-prettier
```

Create `eslint.config.js` with rules for:
- `no-unused-vars` (catch dead code)
- `no-explicit-any` (enforce type safety)
- `no-console` in `server/` and `client/` (enforce pino logger usage)
- `@typescript-eslint/no-floating-promises` (catch missing `await`)

Add `"lint": "eslint ."` and `"format": "prettier --write ."` to package.json scripts, and a lint step in CI.

---

### 2. Eliminate `any` Types (Medium Impact)

**Current occurrences:**
- `server/routes/workouts.ts:86` — `validateExercisesPayload(exercises: any)` → use `unknown`
- `server/routes/plans.ts:43` — `actionFn: (...) => Promise<any>` → type the return value
- `server/strava.ts:123` — `handleStravaStatus(req: any, res: Response)` → use `Request`
- Multiple test files use `as any` for mocking

**Fix:** Replace `any` with `unknown` and narrow via Zod parsing or type guards. For tests, create proper typed mock factories instead of casting to `any`.

---

### 3. Centralize Error Handling (Medium Impact, Medium Effort)

**Problem:** Every route handler has its own try-catch block with nearly identical error logging and `res.status(500).json(...)`. This pattern is repeated 40+ times.

**Recommendation:** Create an `asyncHandler` wrapper:

```typescript
// server/middleware/asyncHandler.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((error) => {
      logger.error(error, `${req.method} ${req.path} failed`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  };
}
```

This eliminates boilerplate try-catch blocks across all routes and ensures consistent error responses.

---

### 4. Stop Silently Swallowing Errors (High Impact)

**Problem:** `triggerAutoCoach(userId).catch(() => {})` in `workouts.ts:207` and `plans.ts:214` silently swallows all errors.

**Fix:** At minimum, log the error:
```typescript
triggerAutoCoach(userId).catch((err) => logger.warn(err, "Auto-coach trigger failed"));
```

---

### 5. Break Up Large Components (Medium Impact, Higher Effort)

**Large components that mix multiple concerns:**

| File | Lines | Suggested Split |
|------|-------|-----------------|
| `WorkoutDetailExercises.tsx` | 649 | Extract `ExerciseDragList`, `ExerciseInputRow`, `VoiceInputButton` |
| `TimelineFilters.tsx` | 336 | Extract `PlanSelector`, `ImportExportActions`, `GoalDialog` |
| `TimelineWorkoutCard.tsx` | 362 | Extract `WorkoutCardHeader`, `WorkoutCardMetrics`, `ExerciseSetsList` |
| `CombineWorkoutsDialog.tsx` | 351 | Extract `WorkoutMergePreview`, `ConflictResolutionForm` |

Each component should ideally stay under 200-250 lines. Extract sub-components and co-locate them in the same directory.

---

### 6. Add React Error Boundaries Per Feature (Low Effort)

**Problem:** Only one global `FallbackErrorBoundary` exists. If the Analytics chart crashes, it takes down the entire app.

**Recommendation:** Wrap each major feature section (Analytics, Timeline, Coach, Settings) in its own error boundary so failures are isolated:

```tsx
<ErrorBoundary fallback={<AnalyticsErrorState />}>
  <AnalyticsDashboard />
</ErrorBoundary>
```

---

### 7. Add Request/Response Type Safety to Express Routes (Medium Impact)

**Problem:** Express route handlers use generic `Request` and `Response` types, losing type safety for params, query, and body.

**Recommendation:** Use typed request handlers:

```typescript
interface CreateWorkoutBody {
  date: string;
  focus: string;
  // ...validated by Zod
}

router.post("/api/workouts", asyncHandler(async (req: Request<{}, {}, CreateWorkoutBody>, res) => {
  const body = insertWorkoutLogSchema.parse(req.body);
  // body is now fully typed
}));
```

---

### 8. Add Database Connection Pooling Configuration (Low Effort)

**Problem:** No explicit connection pool configuration visible. PostgreSQL's `pg` driver defaults to 10 connections, which may not be optimal.

**Recommendation:** Configure pool size based on expected load:
```typescript
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

---

### 9. Add API Versioning (Low Effort, Future-Proofing)

**Problem:** All routes are under `/api/*` with no versioning. Breaking changes to the API would affect all clients simultaneously.

**Recommendation:** Prefix routes with `/api/v1/*`. This allows deploying breaking changes under `/api/v2/*` while maintaining backward compatibility.

---

### 10. Improve Storage Interface Granularity (Medium Effort)

**Problem:** `IStorage` has 35+ methods in a single interface. This makes it harder to mock in tests and violates the Interface Segregation Principle.

**Recommendation:** Split into domain-specific interfaces:

```typescript
interface IUserStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<User | undefined>;
}

interface IWorkoutStorage {
  createWorkoutLog(log: InsertWorkoutLog & { userId: string }): Promise<WorkoutLog>;
  listWorkoutLogs(userId: string, limit?: number, offset?: number): Promise<WorkoutLog[]>;
  // ...
}

interface IStorage extends IUserStorage, IWorkoutStorage, IPlanStorage, IAnalyticsStorage { }
```

Tests can then mock only the relevant sub-interface.

---

### 11. Add Structured Logging Context (Low Effort)

**Problem:** Log messages include error objects but lack request context (userId, requestId, route).

**Recommendation:** Add a request-scoped logger via pino-http that automatically includes `userId` and a unique `requestId`:

```typescript
app.use(pinoHttp({
  logger,
  customProps: (req) => ({
    userId: req.auth?.userId,
  }),
}));
```

This makes debugging production issues significantly easier when filtering logs by user or request.

---

### 12. Consider React 19 Upgrade (Future)

Currently on React 18.3. React 19 brings:
- Server Components support (future SSR potential)
- `use()` hook for cleaner data loading
- Improved Suspense for streaming

Not urgent, but worth planning as dependencies (Radix UI, TanStack Query) add React 19 support.

---

## Priority Matrix

| Priority | Improvement | Effort | Impact |
|----------|------------|--------|--------|
| P0 | Stop silently swallowing errors (#4) | 10 min | High |
| P0 | Add ESLint + Prettier (#1) | 1-2 hrs | High |
| P1 | Centralize error handling (#3) | 2-3 hrs | Medium |
| P1 | Eliminate `any` types (#2) | 1-2 hrs | Medium |
| P1 | Add feature error boundaries (#6) | 30 min | Medium |
| P2 | Break up large components (#5) | 4-6 hrs | Medium |
| P2 | Typed Express requests (#7) | 2-3 hrs | Medium |
| P2 | Structured logging (#11) | 1 hr | Medium |
| P3 | Split IStorage interface (#10) | 3-4 hrs | Low |
| P3 | API versioning (#9) | 1 hr | Low |
| P3 | DB pool config (#8) | 15 min | Low |
| P3 | React 19 upgrade (#12) | Half day | Low |
