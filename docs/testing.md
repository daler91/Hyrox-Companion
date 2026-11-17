# Testing Infrastructure

This document describes the testing infrastructure for the fitai.coach application, covering unit tests, integration tests, end-to-end tests, CI/CD workflows, and conventions.

---

## Table of Contents

1. [Overview](#overview)
2. [Vitest Setup](#vitest-setup)
3. [Unit Test Patterns](#unit-test-patterns)
4. [Component Tests](#component-tests)
5. [Route and Integration Tests](#route-and-integration-tests)
6. [Cypress E2E Tests](#cypress-e2e-tests)
7. [Production Smoke Tests](#production-smoke-tests)
8. [Documentation Sync Tests](#documentation-sync-tests)
9. [Chat Scenario Evals](#chat-scenario-evals)
10. [CI/CD Test Workflows](#cicd-test-workflows)
11. [SonarCloud Quality Gate](#sonarcloud-quality-gate)
12. [Code Review Skill Profiles](#code-review-skill-profiles)
13. [Running Tests](#running-tests)
14. [Debugging Failed Tests](#debugging-failed-tests)
15. [Coverage Enforcement](#coverage-enforcement)
16. [Test File Organization](#test-file-organization)

---

## Overview

The project follows a testing pyramid with three layers:

- **Unit tests (Vitest)** -- Fast, isolated tests for services, utilities, schema validation, React components, and hooks. These form the bulk of the test suite.
- **Integration tests (Vitest, separate config)** -- Tests that exercise API routes against a real PostgreSQL database with the full Express app wired up.
- **End-to-end tests (Cypress)** -- Browser-based tests that verify complete user flows against a running server.

### Test counts

Every number below is stale the moment a test lands, so **derive it, don't trust
it**. The commands are the source of truth; the figures are only a sanity check,
measured at the date given.

| Layer                      | Count (2026-11-16) | How to count it                                                     |
| -------------------------- | ------------------- | -------------------------------------------------------------------- |
| All Vitest test files      | 835                 | `rg --files -g '*.test.ts' -g '*.test.tsx'`                          |
| Unit/component/route tests | 783                 | add `-g '!*.integration.test.ts' -g '!smoke.test.ts'` to the above   |
| Integration tests          | 51                  | `rg --files -g '*.integration.test.ts'`                              |
| Smoke test                 | 1                   | `rg --files -g 'smoke.test.ts'`                                      |
| Cypress E2E specs          | 12                  | `ls cypress/e2e/*.cy.ts`                                             |

Locations: most integration tests sit in `server/storage/__tests__/` (storage
SQL), with the HTTP ones in `server/routes/tests/` and the rest beside the
service or script they exercise (`server/services/`, `server/`, `script/`);
the smoke test is
`server/routes/tests/smoke.test.ts`, run as `pnpm test:smoke`. It spawns the
built `dist/index.js`, so it needs `pnpm build` and a reachable database first —
it is not a quick pre-push check (see [Production Smoke Tests](#production-smoke-tests)).

> The smoke exclusion is `!smoke.test.ts`, **not** `!*.smoke.test.ts`. The file
> is named exactly `smoke.test.ts`, which is also what `vitest.smoke.config.ts`
> includes and `vitest.config.ts` excludes — a `*.`-prefixed glob matches
> nothing and silently leaves the smoke test in the unit count. An earlier
> version of this doc used that glob and named a path that does not exist.

### Coverage thresholds

Coverage is collected by `@vitest/coverage-v8` and is **merge-gating**: CI runs
`pnpm test:coverage`, and the run fails if any metric drops below its threshold.

Thresholds are ratcheted to measured reality rather than set aspirationally —
they exist to catch regressions, and are raised as coverage grows. The
aspirational 80% they replaced was never evaluated by any job, so it enforced
nothing. Current values live in `vitest.config.ts`; as of 2026-07-25:

- Lines: 68%
- Functions: 62%
- Branches: 60%
- Statements: 67%

---

## Vitest Setup

### Unit test configuration (`vitest.config.ts`)

```ts
// Key settings:
plugins: [react()]                        // @vitejs/plugin-react for JSX/TSX
environment: 'jsdom'                      // DOM simulation for component tests
setupFiles: ['./vitest.setup.ts']         // Global setup
globals: true                             // describe/it/expect available globally
env: { NUTRITION_ENABLED: 'true', VITE_NUTRITION_ENABLED: 'true' } // the shipped flag state
exclude: ['**/*.integration.test.ts', '**/smoke.test.ts', '**/node_modules/**', '**/dist/**', '**/cypress/**']
testTimeout: 15000                        // headroom for CPU contention (see Timeouts)
```

The suite runs with nutrition on, as it ships. A test about the flag-off state
pins it itself; don't flip the config default to make a flag-conditional test
pass.

**Path aliases** mirror the Vite dev config:

| Alias     | Resolves to  |
| --------- | ------------ |
| `@`       | `client/src` |
| `@shared` | `shared`     |

**Setup file** (`vitest.setup.ts`):

- Pins `process.env.TZ = "UTC"` so date formatting matches CI on every machine.
- Imports `@testing-library/jest-dom/vitest` for DOM matchers (e.g., `toBeInTheDocument()`).
- Registers the `jest-axe` `toHaveNoViolations()` matcher via `expect.extend()` for automated a11y checks.
- Sets dummy environment variables so modules that read `process.env` at import time do not crash:
  - `DATABASE_URL` -- dummy Postgres URL
  - `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` -- dummy values
  - `ENCRYPTION_KEY` -- 32-character test key

### Integration test configuration (`vitest.integration.config.ts`)

Integration tests use a **separate Vitest config** to run against a real database:

```ts
// Key differences from unit config:
include: ["**/*.integration.test.ts"]; // Only integration test files
environment: "node"; // No jsdom -- server-side only
setupFiles: ["./vitest.integration.setup.ts"];
fileParallelism: false; // Sequential execution to avoid DB conflicts
```

It keeps the unit config's `@` and `@shared` aliases and `globals: true`, and excludes `node_modules` and `dist`.

The integration setup file (`vitest.integration.setup.ts`) sets a test `ENCRYPTION_KEY` and `SESSION_SECRET`, deletes the Clerk env vars so the app falls back to dev auth bypass, and falls back to a dummy `DATABASE_URL` when none is provided by CI.

---

## Unit Test Patterns

### Service tests

Service tests are pure logic tests with no mocking of external systems required. They call service functions directly with crafted input data and assert on the return value.

Example structure (`server/services/analyticsService.test.ts`):

```ts
// 1. Factory helper to build test data
function makeSet(overrides: Record<string, unknown> = {}) {
  return { exerciseName: "back_squat", category: "strength", /* defaults */ ...overrides };
}

// 2. Group by function under test
describe("calculatePersonalRecords", () => {
  it("returns empty object for empty input", () => { ... });
  it("tracks maxWeight PR", () => { ... });
});
```

#### Shared fixtures across sibling suites

When several suites need the same large shape (the ~30-field `ExerciseSet` row or
the `TimelineEntry` shape), define the factory **once** in a shared
`testFixtures.ts` module and import it, rather than copy-pasting the builder into
each `*.test.ts`. For example, `server/services/ai/testFixtures.ts` exports
`makeExerciseSet`, `makeTimelineEntry` and `makeTimelineDays`, consumed by
`trainingStats.test.ts`, `coachingInsights.test.ts` and the `index*.test.ts`
suites beside them:

```ts
import { makeExerciseSet as makeSet, makeTimelineEntry as makeEntry } from "./testFixtures";
```

Keep each builder in one such module: `testFixtures.ts` is not a `*.test.ts`
file and not under `__tests__/`, so SonarCloud analyses it as production source,
and a second copy of a builder in another helper like it would trip the
duplication gate (see [SonarCloud Quality Gate](#sonarcloud-quality-gate)).

### Schema validation tests

Zod schemas are tested by calling `.safeParse()` with valid and invalid payloads and asserting on `result.success` and error messages.

Example (`shared/schema.test.ts`):

```ts
it("rejects a very large csvContent", () => {
  const result = importPlanRequestSchema.safeParse(payload);
  expect(result.success).toBe(false);
  if (!result.success) {
    // Zod 4: the failures are `error.issues` (there is no `error.errors`)
    expect(result.error.issues[0].message).toBe("CSV content must be 100,000 characters or less");
  }
});
```

### Utility tests

Utility functions in `client/src/lib/` and `server/utils/` are tested with straightforward input/output assertions. Files include `dateUtils.test.ts`, `exerciseUtils.test.ts`, `statsUtils.test.ts`, `sanitize.test.ts`, and others.

### Mocking patterns

- **`vi.mock()`** -- Used at the module level to replace imports (storage, services, auth middleware).
- **`vi.fn()`** -- Creates mock functions for individual spies.
- **`vi.mocked()`** -- Provides typed access to mocked functions for assertions.
- **`vi.resetAllMocks()`** -- Called in `beforeEach` to reset mock state between tests.

#### Reset, don't clear, a shared module mock

`vi.clearAllMocks()` only drops call/result history: a `mockResolvedValue()`,
`mockRejectedValue()` or `mockImplementation()` that one test set on a
module-level `vi.mock()` stays attached for every test that runs after it. That
makes the file order-dependent -- it passes in declaration order only because
the test that sets the value happens to run first, and fails the moment the
order changes (`vitest run --sequence.shuffle`, a `.only`, a new test inserted
above). Issue #1710 tracked a long tail of these.

Use `vi.resetAllMocks()` instead, and give each mock its default as
`vi.fn(impl)` in the `vi.mock()` factory rather than `vi.fn().mockResolvedValue(...)`:
`mockReset` restores the implementation passed to `vi.fn()`, so the defaults
survive the reset while per-test overrides do not.

```ts
vi.mock("../../storage", () => ({
  storage: {
    // Restored by resetAllMocks; a test's own override cannot leak onwards.
    analytics: { getWorkoutLogsByDateRange: vi.fn(async () => []) },
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
});
```

The same rule applies to any module-level singleton a test can dirty. Export a
test-only reset (`__resetHealthCacheForTests()` in `server/bootstrap/health.ts`,
`__resetToastStateForTests()` in `client/src/hooks/use-toast.ts`) and call it in
`beforeEach` rather than relying on which test runs first.

### Timeouts

`vitest.config.ts` sets `testTimeout: 15000` and `vitest.setup.ts` sets
Testing Library's `asyncUtilTimeout` to 3000ms -- both well above what any test
needs on an idle machine. The headroom is for CPU contention across the suite's
parallel workers, which has pushed otherwise-instant `findBy*` queries and long
`userEvent` chains past the 1s/5s defaults. Neither hides a real failure: an
element that never appears, or a test that genuinely hangs, still fails. Don't
add per-test retries.

---

## Component Tests

Component tests use **React Testing Library** (`@testing-library/react`) with the `jsdom` environment provided by Vitest.

### Rendering

Components are rendered with `render()` and queried using `screen` queries:

```ts
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

it("renders the button label correctly", () => {
  render(<Button>Save changes</Button>);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});
```

### User interaction

The `@testing-library/user-event` package is available for simulating user interactions (clicks, typing, etc.).

### DOM matchers

`@testing-library/jest-dom` is imported globally via `vitest.setup.ts`, providing matchers such as:

- `toBeInTheDocument()`
- `toHaveClass()`
- `toBeVisible()`

### Hook tests

Custom hooks are tested in files under `client/src/hooks/__tests__/`. These test files use `.test.tsx` extensions when they need JSX for wrapper providers.

### Accessibility tests (jest-axe)

Automated accessibility assertions live alongside the component they cover, using the filename convention **`*.a11y.test.tsx`** inside `__tests__/` directories. Each test renders the component, runs `axe()` against the markup, and asserts `toHaveNoViolations()`. The `toHaveNoViolations` matcher is registered globally in `vitest.setup.ts`, so individual test files only need to import `axe`.

```ts
import { axe } from "jest-axe";

it("has no detectable a11y violations", async () => {
  const { container } = render(<WorkoutHeader title="Log Workout" />);
  expect(await axe(container)).toHaveNoViolations();
});
```

Current a11y coverage includes:

- `client/src/pages/__tests__/not-found.a11y.test.tsx`
- `client/src/components/__tests__/RpeSelector.a11y.test.tsx`
- `client/src/components/__tests__/Breadcrumbs.a11y.test.tsx`
- `client/src/components/ui/__tests__/OfflineIndicator.a11y.test.tsx`
- `client/src/components/workout/__tests__/WorkoutHeader.a11y.test.tsx`
- `client/src/components/timeline/__tests__/TimelineWorkoutCard.a11y.test.tsx`
- `client/src/components/timeline/__tests__/CoachReviewingIndicator.a11y.test.tsx`
- `client/src/components/timeline/__tests__/BulkDeleteToolbar.a11y.test.tsx`
- `client/src/components/coach/__tests__/SuggestionCard.a11y.test.tsx`
- `client/src/components/analytics/__tests__/TrendArrow.a11y.test.tsx`
- `client/src/components/onboarding/__tests__/GoalStep.a11y.test.tsx`
- `client/src/components/onboarding/__tests__/CoachStep.test.tsx`, `WelcomeStep.test.tsx` and `PlanStep.test.tsx` (axe checks alongside their behaviour tests)
- `client/src/components/settings/preferences/__tests__/PreferenceRows.a11y.test.tsx`
- axe checks inside behaviour tests that do not use the `.a11y` suffix: `client/src/pages/__tests__/Landing.test.tsx`, `client/src/components/onboarding/__tests__/GoalStep.raceDate.test.tsx`, `client/src/components/analytics/training-overview/__tests__/BodySystemLoadCard.test.tsx`, `client/src/components/timeline/__tests__/TimelineWorkoutCard.deviceLink.test.tsx`, `client/src/components/timeline/missed-recovery/MissedRecoveryDialog.test.tsx`, `client/src/components/settings/data-tools/RecycleBinCard.test.tsx`, `client/src/components/settings/preferences/__tests__/EmailNotificationsCard.test.tsx` and `client/src/components/workout-detail/__tests__/SessionGradeCard.test.tsx`

Add an a11y test with any new user-facing component (the repository has no PR template, so nothing enforces this). The tests run as part of the normal `pnpm test` Vitest pool — there is no separate command or workflow.

---

## Route and Integration Tests

### Unit-level route tests (`server/routes/__tests__/`)

Route tests use **supertest** to make HTTP requests against an isolated Express app. External dependencies are fully mocked.

**Test app factory** (`server/routes/__tests__/testUtils.ts`):

```ts
export function createTestApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  setupTestErrorHandler(app);
  return app;
}
```

`setupTestErrorHandler` mounts the production `globalErrorHandler` (`server/middleware/errorHandler.ts`), so a route test sees the same `{ error, code, details }` reply, 4xx message and 413 rewrite an athlete would. A test that mocks `../../logger` must therefore also provide `reqLogger`, which the handler logs through.

**Common mocking targets:**

- `../../clerkAuth` -- Replaces `isAuthenticated` middleware to inject a test user (`req.auth = { userId: "test_user_id" }`)
- `../../types` -- Mocks `getUserId()` to return the test user ID
- `../../storage` -- Mocks database storage functions
- `../../services/*` -- Mocks service-layer functions
- `../../queue` -- Mocks the background job queue

`testUtils.ts` also exports factories for the hoisted `vi.mock()` calls, so each test file keeps the call but not the boilerplate: `mockClerkAuthModule()`, `mockTypesModule()` and `mockAiBudgetModule()`, `mockStorageModule(shape)` (a `vi.fn()` for each listed storage method), and the `TEST_USER_ID` constant (`"test_user_id"`):

```ts
vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
```

**Rate limiting:** `clearRateLimitBuckets()` (from `server/routeUtils.ts`, or through `resetRouteTestState()` in `testUtils.ts`) is called in `beforeEach` to reset rate limit state.

### Full integration tests (`server/routes/tests/`)

Integration tests run against a **real PostgreSQL database** (PostgreSQL 16 with pgvector, installed on the runner in CI) with the full Express route tree registered.

**Helper setup** (`server/routes/tests/helpers.ts`):

- `createTestApp()` -- Builds the app with `cookie-parser` and the full route tree (`registerRoutes`), stubs `queue.send` and `queue.work` with `vi.fn()`, and mounts a test error handler that logs the error and replies `{ error, code, details }`.
- `setupIntegrationTest()` -- Lifecycle hook that creates the app once (`beforeAll`), clears the database before each test, inserts a test user (`testUserId`, `dev-user`) to satisfy foreign key constraints, and clears the database and closes the server afterwards.
- `clearDatabase()` -- Deletes all rows from `exerciseSets`, `workoutLogs`, `planDays`, `trainingPlans`, and `users` tables.
- Auth bypass via `ALLOW_DEV_AUTH_BYPASS=true` env var and the `dev-user` user ID.

**Integration test files:**

| File                                                     | Purpose                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `server/routes/tests/api.integration.test.ts`            | Tests plans, preferences, timeline, and workout CRUD against a real database                |
| `server/routes/tests/post-migration.integration.test.ts` | Verifies database schema correctness after migrations (used in the post-migration workflow) |

### Storage-layer integration tests (`server/storage/__tests__/*.integration.test.ts`)

The storage unit tests next to these mock `db` wholesale, so they prove nothing
about the SQL Drizzle actually generates — ownership joins, cascade ordering,
windowing, unique constraints. These suites run the real `storage.*` methods
against the same Postgres the HTTP integration tests use (same config, same
`fileParallelism: false`), with `server/storage/__tests__/integrationDb.ts`
providing an FK-safe `resetIntegrationDb()` and seed helpers (`seedUser`,
`seedWorkoutLog`, `seedExerciseSet`, `seedCustomFood`, `seedFoodLogEntry`). Add one here
whenever a storage method's correctness rests on a predicate, join, or
constraint rather than on branch logic.

| File                                                            | Purpose                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `server/storage/__tests__/erasure.integration.test.ts`          | GDPR account erasure (`deleteUserAndPrivateCustomFoods`): cascade, reference-guarded food deletion, public foods |
| `server/storage/__tests__/exerciseSetOwnership.integration.test.ts` | Exercise-set mutation IDOR guards (workout and plan-day owners), the W18 optimistic lock, the L4 unit re-stamp |
| `server/storage/__tests__/timelineWindow.integration.test.ts`   | `getTimeline`: three-source merge per athlete, newest-first ordering, limit/offset windowing, set hydration; `getTimelinePage` pages a plan day by the date its entries are shown on, so a card logged off its slot is on exactly one page (C43) |
| `server/storage/__tests__/nutritionLogging.integration.test.ts` | Food visibility predicate, food-log round trip and ownership, one-version-per-day targets (migration 0091)      |
| `server/storage/__tests__/completedDates.integration.test.ts`  | `getCompletedWorkoutDates`: distinct dates of logged workouts that count as training (a synced walk does not) and of completed plan days with no log (a late-logged day counts on its log's date only, C44), parity with the full timeline's completed training |
| `server/storage/__tests__/recycleBin.integration.test.ts`      | Recycle bin: capture inside the delete transaction, restore with the original ids and re-links (plan day, MAF analysis, plan-day status), all-or-nothing batch restore, device-sync dedupe while binned, per-user isolation |

The table describes six of the suites; `ls server/storage/__tests__/*.integration.test.ts`
lists all of them (31 on 2026-11-17).

Run them locally against any Postgres with the `vector` extension:
`CREATE EXTENSION IF NOT EXISTS vector; pnpm exec drizzle-kit push; DATABASE_URL=… pnpm exec vitest run --config vitest.integration.config.ts`.

---

## Cypress E2E Tests

### Configuration (`cypress.config.ts`)

```ts
projectId: "dy8p9y"; // Cypress Cloud project for recording/parallelism
allowCypressEnv: false;
// under e2e:
baseUrl: "http://localhost:5000"; // the server the specs run against
specPattern: "cypress/e2e/**/*.cy.ts";
supportFile: "cypress/support/e2e.ts";
video: true;
screenshotOnRunFailure: true;
viewportWidth: 1280;
viewportHeight: 720;
defaultCommandTimeout: 10000; // 10 seconds
```

### E2E spec files

| Spec file                                  | Coverage area                    |
| ------------------------------------------ | -------------------------------- |
| `cypress/e2e/analytics.cy.ts`              | Analytics dashboard              |
| `cypress/e2e/api-validation.cy.ts`         | API input validation             |
| `cypress/e2e/coach-chat.cy.ts`             | Coach chat flow                  |
| `cypress/e2e/emom-rollout-config.cy.ts`    | EMOM rollout configuration       |
| `cypress/e2e/landing.cy.ts`                | Landing/marketing page           |
| `cypress/e2e/log-workout.cy.ts`            | Workout logging form             |
| `cypress/e2e/log-workout-submission.cy.ts` | Workout form submission          |
| `cypress/e2e/navigation.cy.ts`             | Sidebar navigation, routing, 404 |
| `cypress/e2e/onboarding.cy.ts`             | Onboarding flow                  |
| `cypress/e2e/plan-generation.cy.ts`        | AI plan generation flow          |
| `cypress/e2e/settings.cy.ts`               | Settings page                    |
| `cypress/e2e/timeline.cy.ts`               | Timeline view                    |

### Support files

**`cypress/support/e2e.ts`** -- Global setup:

- Imports custom commands from `./commands`.
- Suppresses uncaught exceptions whose message mentions `clerk.example.com` (Clerk SDK in test mode).
- Sets the privacy-consent key (`fitai-privacy-consent-v1`) in `localStorage` on every `window:before:load`, so the consent banner does not overlay the bottom of the viewport.
- Intercepts all requests to `https://clerk.example.com/**` with a `200 {}` response in `beforeEach`, preventing Clerk from interfering with tests.

**`cypress/support/commands.ts`** -- Custom commands:

- `cy.getBySel(selector)` -- Shorthand for `cy.get('[data-testid="..."]')`. This is the standard way to select elements in E2E tests.
- `cy.ensureConsentDismissed()` -- Sets the privacy-consent key on the live window if it is missing and dispatches `fitai:privacy-consent-changed`, so the consent banner hides even if it mounted before the key was set.
- `cy.advanceLogWorkoutToReflect(text)` -- Drives the log-workout stepper from Capture to Reflect, typing `text` first when it is non-empty (then waits on a `@parseExercises` intercept the spec must register).
- `cy.completeReflectAndSaveWorkout(notes?)` -- From Reflect: optionally types notes, skips RPE, and saves.

**`cypress/support/authIntercepts.ts`** -- Authentication bypass:

The `setupAuthIntercepts()` function stubs the API endpoints the authenticated screens read on load, so tests can run without real auth or data. It intercepts:

- `GET /api/v1/csrf-token` -- Returns a fixed CSRF token (alias `@csrfToken`)
- `GET /api/v1/auth/user` -- Returns a mock user, id `FIXTURE_ATHLETE_ID` (`test-user-123`) (alias `@authUser`)
- `GET /api/v1/preferences` -- Returns default preferences (configurable via `overrides`)
- `GET /api/v1/timeline*`, `GET /api/v1/timeline-annotations*`, `GET /api/v1/plans`, `GET /api/v1/workouts*`
- `GET /api/v1/personal-records*`, `GET /api/v1/exercise-analytics*`, `GET /api/v1/training-overview*`
- `GET /api/v1/strava/status`, `GET /api/v1/exercise-history*`, `GET /api/v1/custom-exercises*`, `GET /api/v1/chat/history`

The same file exports `skipOnboardingOnLoad(win)`, passed as `cy.visit`'s `onBeforeLoad` so the onboarding wizard does not auto-open over the screen under test.

The timeline, timeline annotations, plans, workouts, personal records, exercise analytics, training overview, Strava status and preferences responses can be overridden per test; the rest return fixed defaults:

```ts
setupAuthIntercepts({
  workouts: [{ id: "1", date: "2026-01-15", ... }],
  preferences: {
    weightUnit: "lbs",
    distanceUnit: "miles",
    weeklyGoal: 3,
    emailNotifications: false,
    emailWeeklySummary: false,
    emailMissedReminder: false,
  },
});
```

**`cypress/support/logWorkoutHelpers.ts`** -- Log-workout spec helpers: `stubParseExercisesEmpty()` (stubs both parse endpoints under the `@parseExercises` alias), `stubSaveWorkout(responseOverride?)` (stubs `POST /api/v1/workouts` as `@saveWorkout`) and `visitLogWorkoutPage()` (the pattern below, plus `cy.ensureConsentDismissed()`).

### Test pattern

Every authenticated E2E test follows this structure:

```ts
beforeEach(() => {
  setupAuthIntercepts();
  cy.visit("/log");
  cy.wait("@authUser");
});

it("shows the workout form", () => {
  cy.getBySel("input-workout-title").should("exist");
});
```

---

## Production Smoke Tests

**File:** `server/routes/tests/smoke.test.ts`

An end-to-end check that the **built** server actually boots and serves. It spawns `dist/index.js` as a child process on port 5111 with `ALLOW_DEV_AUTH_BYPASS=true`, polls `/api/v1/health` until the server reports ready (60 s budget), then drives the running server over HTTP with a small cookie jar, and shuts it down with `SIGTERM` afterwards. Nothing is mocked, so this needs a **real build and a real database** — it is the test that catches a break no unit test can see, like a bundle that compiles but crashes on boot.

### Configuration

The smoke test uses a **separate Vitest config** (`vitest.smoke.config.ts`):

- Included only via the `**/smoke.test.ts` glob; excluded from the standard unit test suite
- Uses `node` environment (no jsdom)
- Shares the integration setup file (`vitest.integration.setup.ts`)
- Runs with `fileParallelism: false`
- Gets a 90-second per-test timeout, since it builds up a real server process. That is set on the `describe` in `smoke.test.ts` (`{ timeout: 90_000 }`), not in this config
- Runs as its own step in the Cypress workflow (`cypress.yml`), on container 1 only, after the build and `drizzle-kit push` steps

### What's Tested

- **Health & startup**: `/api/v1/health` returns `ok` with a numeric timestamp
- **Frontend serving**: `/` returns the SPA shell; hashed `/assets/*.js` and `*.css` are served, with `max-age` on the JS bundle
- **Security headers**: `X-Powered-By` absent, `Content-Security-Policy` present with `default-src`, `X-Content-Type-Options: nosniff`
- **CSRF**: the token endpoint issues a token; a `POST` without one is rejected with `403`; the same `POST` with a valid token is not a `403`
- **Authentication**: `GET /api/v1/auth/user` returns the dev user
- **Workout CRUD lifecycle**: create → list → fetch by id → update → delete → `404`
- **Plans & analytics**: `/plans`, `/personal-records`, `/exercise-analytics`, `/training-overview` (asserting its four top-level keys) and `/timeline`
- **Export**: `?format=json` and `?format=csv`
- **Error handling**: an unknown client route falls through to the SPA; an unknown `/api/v1/*` path returns a JSON `404` (`{ error: "API route not found", code: "NOT_FOUND" }`), not the SPA shell; an invalid workout payload returns `400`
- **Strava**: `/api/v1/strava/status` reports `connected: false`

### Running Smoke Tests

```bash
pnpm test:smoke
# equivalent to:
pnpm exec vitest run --config vitest.smoke.config.ts
```

---

## Documentation Sync Tests

**File:** `test/docs/docsSync.test.ts`

Several doc catalogues are enumerations of things the repo registers — pg-boss queues, cron advisory-lock keys, environment variables, storage domains, schema tables, CI workflows — and each has silently drifted at least once, because nothing fails when someone adds a queue and stops there. Anchors rot the same way: renumbering `architecture.md`'s headings broke four inbound links from other documents. These tests are that failure: add a queue, a cron job, an env var, a storage domain, a table or a workflow, or point a link at a heading that no longer exists, and the matching test goes red.

| Assertion | Canonical doc | Source of truth |
|---|---|---|
| Every registered pg-boss queue is listed | `docs/integrations.md` § Job Types | `queue.createQueue(...)` / `queue.work(...)` across `server/` |
| Every cron advisory-lock key is listed | `docs/integrations.md` § Registered Cron Jobs | `CRON_LOCK_KEYS` in `server/cron.ts` |
| Every env var is documented | `docs/env-reference.md` | the Zod schema in `server/env.ts` |
| Every storage domain is in the documented facade | `docs/database.md` § Composed Facade | the `storage` object in `server/storage/index.ts` |
| Every schema table is documented | `docs/database.md` § Schema Tables | every `pgTable(...)` under `shared/schema/` |
| Every CI workflow is listed | `docs/testing.md` § CI/CD Test Workflows | the files in `.github/workflows/` |
| Every internal doc link and anchor resolves | all `*.md` in the repo | the headings they point at |

The facade assertion compares the two objects property for property, because `database.md` reproduces that exact code block and had drifted from it. The table assertion accepts either of the two ways `database.md` documents a table — its own `### <table>` section, or an inline `` `backticked` `` mention for the nutrition tables covered column-by-column in `nutrition.md` — but deliberately does **not** accept a bare name inside a fenced code block: `exercise_load_tags` went undocumented for exactly that reason, appearing only inside a migration *filename*. The link check uses GitHub's slug rule — lowercase, punctuation dropped, **each** space becoming its own hyphen, so `## Core & Security` is `#core--security` — and covers both relative file paths and `#fragment` anchors.

They parse the source text rather than importing the modules: `server/env.ts` validates the environment and writes to stderr at import, and `server/queue.ts` pulls in pg-boss. Each test also asserts its extractor found a non-zero number of entries, so a regex that stops matching fails loudly instead of passing vacuously.

**When one fails,** add the missing entry to the doc named in the failure message. Do not add a second copy elsewhere — `docs/server.md` used to carry duplicate cron and queue tables and drifted from both; they are now links to the canonical lists.

This is the same idea as `shared/schema/checkConstraints.test.ts`, which pins a rendered CHECK constraint to the TypeScript constant it derives from so the matching migration can't be forgotten.

---

## Chat Scenario Evals

**Files:** `test/evals/chatScenarios.ts` (the scenarios), `test/evals/runChatScenario.ts` (asks the coach), `test/evals/judge.ts` (grades the reply), `test/evals/chatScenarios.eval.test.ts` (the live run)

Golden conversations for the coach chat, each graded by an LLM judge against its own criteria (AI coach chat review, I22). They cover what a unit test can't see because it depends on the model: red-flag escalation, the load governor's danger zone and the race-week taper holding in chat, never claiming a plan change that wasn't applied (a direct request, "yes please" after an offer, a dismissed proposal), the athlete's units, "this one" meaning the focused workout, refusing to reveal the prompt, undoing a change the coach made, putting back a move the athlete made on the timeline, and saying what happened to a moved session (from its record of recent plan changes, never by asking the athlete for the dates), and naming the right weekday for a planned session. Most run in two modes: `classic` (`chatWithCoach`, the prompt as shipped) and `tools` (`streamChatWithCoachTools` with canned read-tool results, the `AI_CHAT_TOOLS` path), and tools-mode scenarios also check which tools were called, e.g. that "yes please" after an offer calls `propose_plan_changes`.

Each run builds the request the chat route would (the same safety scan, focused-workout block and app notes) and sends it to the configured text provider. The judge, the reasoning model at low effort, gets the facts the coach had, the conversation, the reply as data and the numbered criteria, and returns a verdict per criterion; a criterion it skips, or an answer that isn't the JSON asked for, fails. A reply the output validator refuses fails too: the athlete would have seen an error.

They are off by default, since they cost money and depend on a live model. Run them on every prompt or model change, with the provider keys in `.env`:

```bash
pnpm eval:chat                       # both modes
AI_EVAL_MODES=tools pnpm eval:chat   # one mode
```

The run prints a pass/fail table and, for each failure, the criterion, the judge's reason and the reply. The scenario fixtures are checked without a model in CI (`test/evals/*.test.ts`): each scenario's situation must actually reach the system prompt (the governor block, the plan phase, the units line, the focused workout, the recent plan changes, the weekday labels), so a prompt change can't quietly make an eval meaningless. `server/services/aiEval.test.ts`, the older keyword checks, sits behind the same `RUN_AI_EVAL=true`.

---

## CI/CD Test Workflows

All workflows are in `.github/workflows/` and run on GitHub Actions with Ubuntu runners. Node-based workflows use Node.js 22 via pnpm.

### 1. Unit Tests (`test.yml`)

- **Name:** Unit Tests
- **Triggers:** Push to `main`, pull request (opened/synchronize/reopened)
- **Steps:** Checkout, install pnpm + Node.js 22, `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm test:coverage` (the suite plus the coverage thresholds — see [Coverage Enforcement](#coverage-enforcement))
- **Environment:** Dummy values for `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY`

### 2. Cypress Tests (`cypress.yml`)

- **Name:** Cypress Tests
- **Triggers:** Every push **and** every pull request, so a fork/PR branch gets the same end-to-end gate as a push to a branch in this repository. Secrets are unavailable on fork PRs, so every secret-backed value has an inert fallback the suite can run against.
- **Database:** PostgreSQL 16 with pgvector on port 5432. The runner's preinstalled PostgreSQL 16 is started by the shared `.github/actions/setup-postgres-pgvector` step, which installs `postgresql-16-pgvector` from the PostgreSQL project's apt repository (apt.postgresql.org, the one the runner image installs PostgreSQL from) and refreshes only that repository, so an outage of Ubuntu's archive mirrors can't fail the job. It is not pulled as a `pgvector/pgvector:pg16` service container, whose unauthenticated Docker Hub pulls were failing runs with `toomanyrequests`
- **Parallelism:** Decided once by a `plan` job: with a `CYPRESS_RECORD_KEY`, two containers split the specs; without it, a single container runs everything (two unrecorded containers would each run the full suite). The `cypress-run` job is pinned to `ubuntu-24.04`, the image that ships the PostgreSQL 16 it starts.
- **Steps:**
  1. Install dependencies with `--ignore-scripts`, install the Cypress binary on a cache miss (cached under `~/.cache/Cypress`, keyed on `pnpm-lock.yaml`), then patch the Cypress bundled dependencies (`node script/patch-cypress-deps.js`)
  2. Build the application (`pnpm run build`)
  3. Verify client-bundle invariants (`pnpm check:bundle`, `script/bundle-check.ts`; the build itself only warns on them)
  4. Enable pgvector extension
  5. Push database schema with `drizzle-kit push` — this comes **before** the suites below, which need the schema to exist
  6. Run integration tests: `pnpm exec vitest run --config vitest.integration.config.ts` (container 1 only)
  7. Run the smoke test: `pnpm exec vitest run --config vitest.smoke.config.ts` (container 1 only)
  8. Start the built server in test mode (`NODE_ENV=test`, `ALLOW_DEV_AUTH_BYPASS=true`, `PORT=5000`, and a per-run `CRON_SECRET`)
  9. Wait for server health check at `/api/v1/health` (`node script/wait-for-health.js`, 120 s by default via `HEALTH_TIMEOUT_MS`)
  10. Run Cypress, recording to Cypress Cloud only when `CYPRESS_RECORD_KEY` is set
- **Secrets:** all optional. `CYPRESS_RECORD_KEY` turns on recording and the two-container split; `GEMINI_API_KEY`, `SENTRY_DSN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `VITE_SENTRY_DSN` are passed through when present, and the server boots without them.

### 3. Check Migrations (`migrations.yml`)

- **Name:** Check Migrations
- **Triggers:** Push to `main`, pull request (opened/synchronize/reopened)
- **Jobs:**
  - `check-migrations` -- runs `pnpm run db:check` for internal consistency, then `pnpm run db:generate` followed by `git diff --exit-code migrations/` to verify migrations are up to date with the schema.
  - `fresh-db-migrate` -- applies the **real** migration SQL to a fresh PostgreSQL (16 with pgvector, installed on the runner the same way as in `cypress.yml`), so a migration that fails at apply time on a fresh database is caught: the job above never applies SQL, and `cypress.yml` provisions its database with `drizzle-kit push`. It runs `pnpm run db:migrate` twice (the second run must be an idempotent no-op), checks that the applied count in `__drizzle_migrations` equals the entries in `migrations/meta/_journal.json`, and probes the critical tables (`users`, `workout_logs`, `plan_days`, `foods`, `analytics_results`, `user_training_style`, `maf_profile`, `maf_test_results`, `maf_workout_analysis`).

### 4. Post-Migration Verification (`post-migration.yml`)

- **Name:** Post-Migration Verification
- **Triggers:** Manual (`workflow_dispatch`)
- **Steps:** Applies migrations to Neon database via `pnpm run db:migrate`, then runs `post-migration.integration.test.ts` against the real Neon database to verify schema correctness. The database URL comes from the `NEON_DATABASE_URL` secret.
- **A database built by `drizzle-kit push`** (empty ledger): dispatch with `ledger: push` and `sql_files` naming the migration files to apply. It skips `drizzle-kit migrate`, which fails at 0000 on such a database, applies each named file with `psql` in its own transaction, and skips the test's migration-ledger count (D24). Production is not one: it applies its migrations at boot and its ledger is populated, so use the `migrate` default there, and never run `drizzle-kit push` against it (`docs/operations/pending-manual-steps.md`).

### 5. Build (`build.yml`)

- **Name:** Build
- **Triggers:** Push to `main`, pull request (opened/synchronize/reopened)
- **Job:** `lint-and-typecheck`, which runs five gates in order:
  1. **ESLint** -- `pnpm eslint .`
  2. **TypeScript** -- `pnpm check`, the repo-wide typecheck (TS 7 native compiler)
  3. **TypeScript (`noUncheckedIndexedAccess` ratchet)** -- `pnpm check:strict`, which applies `tsconfig.strict.json` to a deliberately narrow subset (currently `shared/**`). The subset is expanded directory by directory as each is cleaned up; see [CONTRIBUTING.md](../CONTRIBUTING.md).
  4. **TypeScript (test suite)** -- `pnpm check:test`. The main `tsconfig.json` excludes only `**/*.test.ts` (so `*.test.tsx` files under `client/src` are already typechecked by `pnpm check`), which means that without this gate no job would typecheck the `.test.ts` files at all. `tsconfig.test.json` carries a shrinking exclude list of pre-existing offenders; every newly added test is checked.
  5. **OpenAPI snapshot is up-to-date** -- regenerates the spec and fails on `git diff` against the committed [`docs/openapi.json`](openapi.json).
- **Install:** `pnpm install --frozen-lockfile --ignore-scripts`, which also skips this repo's own `postinstall` (it only patches deps vendored inside the Cypress binary, which this job never touches).
- **Note:** SonarQube Cloud automatic analysis is configured outside these manual workflow steps.

### 6. OpenAPI Breaking Changes (`openapi-breaking.yml`)

- **Name:** OpenAPI Breaking Changes
- **Triggers:** Pull request (opened/synchronize/reopened/labeled/unlabeled) touching `docs/openapi.json`, the checker (`script/openapiBreaking.ts`, `script/openapi-breaking.ts`) or the workflow
- **Steps:** Checkout, install, fetch the base branch, then `pnpm openapi:breaking <base openapi.json> docs/openapi.json` (the CLI `script/openapi-breaking.ts` over `script/openapiBreaking.ts`); it passes without comparing when the base branch has no `docs/openapi.json`. It fails on a change that would break an installed native app build: a removed operation or success response; a response field removed, retyped, no longer always present or newly nullable; a request that gains a required field or parameter, loses an enum value or tightens a length. A response enum gaining a value, or a changed pattern or union, is printed as a warning without failing.
- **Override:** the job is skipped on a PR labelled `openapi-breaking-ok`, for a deliberate break shipped with a raised `MIN_APP_VERSION_*`. Label changes re-run only this workflow.
- **Related:** `test/docs/openapiCoverage.test.ts` (in the unit suite) keeps every registered `/api` route either documented, on the shrink-only `test/docs/openapiUndocumented.ts` list, or excluded as not a client endpoint.

### 7. Mobile Core (`mobile.yml`)

- **Name:** Mobile Core
- **Triggers:** Push to `main` and pull requests touching `mobile/**`, `docs/openapi.json`, `shared/**`, `script/kotlin-models/**`, `script/kotlin-catalogue/**`, `script/mobile-fixtures/**` or the workflow (a push to `main` touching `mobile-release.yml` also runs it); also run by hand (`workflow_dispatch`) for a fresh test build
- **Steps:** two jobs, both in `mobile/` with the runner's JDK 21 and a Gradle download cache. See [`mobile/README.md`](../mobile/README.md).
  - *Kotlin core (JVM)*: `./gradlew :core:jvmTest :composeApp:jvmTest`. It compiles the Kotlin API models generated from `docs/openapi.json` and runs `ApiContractTest` (every endpoint's sample request and response JSON decodes, the forward-compatibility samples included), the runtime tests, the golden-fixture tests of the Kotlin ports of `shared/` logic, the shared UI's view-model tests, `ContrastTest` (WCAG AA for every token pair, both themes), and the Compose UI tests that render the whole app on the desktop JVM (`AppUiTest`, `AccessibilityUiTest`: labels and 48 dp touch targets).
  - *Android app*: builds the debug APK and an unsigned release bundle (R8), runs the Robolectric tests and checks the design-system screenshots against the committed references (`verifyRoborazziAndroidHostTest`; the differences are uploaded as `screenshot-diffs` when they fail), then Android lint, ktlint and detekt. The debug APK is kept for 14 days as the `fitai-test-<run number>.apk` artifact, a test build to install on a phone. It signs in with the `CLERK_PUBLISHABLE_KEY` repository variable (the build warns, and sign-in fails, without it) and needs the `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID` and `FIREBASE_SENDER_ID` variables for push; the optional `ANDROID_TEST_KEYSTORE_BASE64` secret signs every test build with the same debug key, so each installs over the last.
- **Related:** in the unit suite, `script/kotlin-models/generate.test.ts`, `script/kotlin-catalogue/catalogue.test.ts` and `script/mobile-fixtures/fixtures.test.ts` fail while the committed models, exercise catalogue or fixtures differ from what their sources generate; run `pnpm mobile:models`, `pnpm mobile:catalogue` or `pnpm mobile:fixtures`.

### 8. Mobile release and on-demand checks

- **Mobile Release** (`mobile-release.yml`) -- On a `mobile-v<major>.<minor>.<patch>` tag: runs the JVM tests, builds the signed release bundle and uploads it to Play's internal track (Gradle Play Publisher), keeping the bundle and its R8 mapping as an artifact. Uses the `play-store` environment, with the `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` and `ANDROID_PUBLISHER_CREDENTIALS` secrets and the `CLERK_PUBLISHABLE_KEY` and `FIREBASE_*` variables. A tag that is not `mobile-v<major>.<minor>.<patch>`, or a minor or patch above 999, fails the run.
- **Mobile Promote** (`mobile-promote.yml`) -- Run by hand: moves a release between Play tracks (internal → `alpha`, the closed test → production), production as a staged rollout by user fraction. Uses the `play-store` environment and its `ANDROID_PUBLISHER_CREDENTIALS` secret.
- **Mobile Performance** (`mobile-performance.yml`) -- Run by hand, on an emulator (a Gradle Managed Device, Pixel 6 / API 34): generates the Baseline Profile (uploaded as the `baseline-profile` artifact, to be committed) and runs the Macrobenchmark startup and frame-timing benchmarks, checking them against `mobile/baselineprofile/budgets.json` with `pnpm mobile:perf-budgets` (`script/mobile-perf/`). The `STAGING_CLERK_PUBLISHABLE_KEY`, `STAGING_API_BASE_URL` and `FITAI_TEST_EMAIL` variables are optional; without them both steps stop at the sign-in screen and the jank benchmark is skipped.
- **Mobile E2E** (`mobile-e2e.yml`) -- Run by hand: the debug app against staging on an emulator (API 34), driven by the Maestro flows in `mobile/maestro/` (sign-in with a Clerk test account, every tab, logging a workout, sign-out). It fails at once unless the `STAGING_CLERK_PUBLISHABLE_KEY`, `STAGING_API_BASE_URL` and `FITAI_TEST_EMAIL` repository variables are set; the JUnit report and screenshots are uploaded as the `maestro` artifact.

### 9. Other workflows

- **Secret Scan** (`gitleaks.yml`) -- Gitleaks secret scanning on push to `main` and on pull request. Scans **incrementally** -- only the commits the push or PR introduces -- so it blocks new secrets without re-flagging already-revoked ones buried in old history. Added after a former `.replit` config leaked an `ENCRYPTION_KEY`; that key has since been rotated through the keyring.
- **DevSkim** (`devskim.yml`) -- Static security analysis (DevSkim CLI 1.0.70) on push to `main`, pull requests into `main` and weekly on Saturday; results are uploaded as SARIF to the Security tab. It ignores `pnpm-lock.yaml`, `mobile/core/src/commonTest/resources/`, `mobile/gradle/verification-metadata.xml` and `mobile/core/schemas/`.
- **Bearer** (`bearer.yml`) -- Static security and privacy analysis on push to `main`, pull requests into `main` and weekly on Saturday, using the `BEARER_TOKEN` secret. It runs with `exit-code: 0`, so findings go to the Security tab as SARIF and never fail the run.
- **Dependency Review** (`dependency-review.yml`) -- Reviews dependency changes in PRs into `main`, comments a summary on the PR, and fails on a newly introduced dependency with a moderate-or-higher advisory (`fail-on-severity: moderate`)

---

## SonarCloud Quality Gate

Pull requests are analysed by **SonarQube Cloud** (project key
`daler91_Hyrox-Companion`) through **Automatic Analysis**, which reads
`.sonarcloud.properties`, not `sonar-project.properties`. The latter applies
only to a CI-based scan, and the scan job for one is commented out in
`build.yml`. The gate runs on the PR diff ("new code") and reports back as the
**SonarCloud Code Analysis** check. These conditions most often affect test-only PRs:

- **Duplication on New Code ≤ 3%.** `*.test.ts`/`*.test.tsx` files and anything
  under `__tests__/` or `test/support/` are excluded from analysis, so
  duplication between test files does not count. A test helper that lives
  anywhere else (for example `server/services/ai/testFixtures.ts`) is analysed
  as production source: copy-pasting a large fixture factory (the ~30-field
  `ExerciseSet` or `TimelineEntry` builder) into a second such module trips
  this gate. Keep one shared builder — see
  [Shared fixtures](#shared-fixtures-across-sibling-suites).
- **No commented-out code (`S125`).** Keep explanatory comments in prose.
  Comments that read as code — method chains like `select().from().where()`, or
  `last3 = [8, 8, 8]` — can be flagged as commented-out code; describe the intent
  instead of pasting a snippet.
- **Coverage on New Code** and **Security Hotspots reviewed.** New production code
  should ship with tests, and any flagged hotspots must be triaged.

`.sonarcloud.properties` sets `sonar.exclusions` to Drizzle SQL migrations
(`migrations/**`, `**/*.sql`; the PL/SQL analyzer would otherwise flag them with
Oracle-only rules), test files (`**/*.test.ts`, `**/*.test.tsx`,
`**/__tests__/**`, `**/test/support/**`), the Kotlin generated from
`docs/openapi.json` and the exercise catalogue (`mobile/**/generated/**`) and
the Kotlin test source sets (`mobile/**/src/*Test/**`). It also declares the
same test patterns through `sonar.tests`/`sonar.test.inclusions`, and
`sonar.cpd.exclusions` drops three curated data tables
(`server/prompts/exerciseSelection.ts`, `server/services/ai/exerciseKnowledge.ts`,
`client/src/pages/landing/landingCopy.ts`) from duplication detection only. The
`coverage/lcov.info` report path (`sonar.javascript.lcov.reportPaths`) lives
only in `sonar-project.properties`, so it takes effect only if the project
switches to the CI scanner. A failing
gate posts a "Quality Gate failed" comment listing the failed conditions; a
passing gate may still list non-blocking new issues worth cleaning up.

Three async rules come up most in production code: `await` inside a loop, an
`async` function with no `await`, and a `.then`/`.catch` chained inside another
promise's callback. Run work that has to go one item at a time (writes on one
transaction client, calls to a rate-limited provider, an ordered replay) through
`inSequence` from `shared/inSequence.ts`, with `inChunks` to batch a long IN
list. Use `Promise.all` for independent work. Write a retry or a poll
recursively, since each step waits on the one before it. An `async` function
that returns a Drizzle query should `return await` it: Sonar can't resolve
Drizzle's types, so a bare `return` reads as an `async` function with nothing to
await.

---

## Code Review Skill Profiles

The `.claude/commands/review/` directory contains structured code-review prompts ("skill profiles") that frame a walkthrough of the codebase from a specific role's perspective. They complement automated tests by surfacing issues that linters and unit tests miss — architectural drift, UX regressions, privacy gaps, and so on.

| Profile       | File                                     | Role                                                                            |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `security`    | `.claude/commands/review/security.md`    | Senior security auditor — vulnerabilities, exposed secrets, auth gaps           |
| `privacy`     | `.claude/commands/review/privacy.md`     | Data privacy officer — collection, storage, transmission, retention, compliance |
| `ux`          | `.claude/commands/review/ux.md`          | UX / accessibility expert — usability, flow, responsiveness, WCAG compliance    |
| `performance` | `.claude/commands/review/performance.md` | Performance engineer — bottlenecks, memory leaks, optimization opportunities    |
| `business`    | `.claude/commands/review/business.md`    | Business analyst — requirements, logic, business-value alignment                |
| `qa`          | `.claude/commands/review/qa.md`          | QA engineer — edge cases, race conditions, failure modes                        |
| `devops`      | `.claude/commands/review/devops.md`      | DevOps engineer — deployment readiness, error handling, logging, infra          |
| `all`         | `.claude/commands/review/all.md`         | Runs every profile and produces a unified report                                |

Invoke a profile inside Claude Code with `/review:<profile>` (for example, `/review:security` or `/review:all`). Each profile defines the review scope, the output format, and the severity bands — so repeated runs produce comparable reports.

---

## Running Tests

### Commands

| Command                                                      | Description                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm test`                                                  | Run all unit tests once (`vitest run`)                                  |
| `pnpm test:watch`                                            | Run unit tests in watch mode (`vitest`)                                 |
| `pnpm exec vitest run --config vitest.integration.config.ts` | Run integration tests (requires a running PostgreSQL database)          |
| `pnpm exec cypress open`                                     | Open Cypress interactive runner (requires the app running on port 5000) |
| `pnpm exec cypress run`                                      | Run Cypress tests headlessly                                            |
| `pnpm eval:chat`                                             | Run the chat scenario evals against a live model (see [Chat Scenario Evals](#chat-scenario-evals)) |

### Coverage reporting

To generate a coverage report, run:

```bash
pnpm exec vitest run --coverage
```

This is what CI runs (`pnpm test:coverage`). It enforces the thresholds defined
in `vitest.config.ts` and fails if any metric drops below them. It also writes
`coverage/lcov.info`.

### Running integration tests locally

Integration tests require a real PostgreSQL database. Set the following environment variables:

```bash
export DATABASE_URL="postgresql://localhost:5432/testdb"
export ALLOW_DEV_AUTH_BYPASS="true"
export ENCRYPTION_KEY="01234567890123456789012345678901"
```

Add a user name and password to `DATABASE_URL` if your local server requires them.

Then push the schema and run:

```bash
npx drizzle-kit push
pnpm exec vitest run --config vitest.integration.config.ts
```

---

## Debugging Failed Tests

### Running a Single Test

```bash
# Run a specific test file
pnpm exec vitest run server/routes/__tests__/workouts.test.ts

# Run tests matching a pattern
pnpm exec vitest run -t "should return 404"

# Run in watch mode for a specific file
pnpm exec vitest watch server/services/workoutService.test.ts
```

### Common CI vs Local Mismatches

- **Timezone issues**: CI runs in UTC. Use `toIsoDateUtc()` from `@shared/dateUtils` instead of `new Date().toISOString()` for date comparisons.
- **Rate limiting**: Tests that hit the same endpoint rapidly may trigger rate limits. Use `clearRateLimitBuckets()` from `server/routeUtils.ts` in `beforeEach`.
- **Database state**: Integration tests share a real database. Always use `clearDatabase()` in setup. Check for leaked state from parallel test runs.
- **Missing env vars**: CI may not have all optional env vars. Tests that depend on `GEMINI_API_KEY` should be conditional or mocked.

---

## Coverage Enforcement

Coverage thresholds are configured in `vitest.config.ts` (excerpt — the file also
lists coverage excludes):

```typescript
coverage: {
  // provider defaults to 'v8' (@vitest/coverage-v8 is installed)
  include: ['client/src/**', 'server/**', 'shared/**'],
  reporter: ['text', 'lcovonly'],
  thresholds: {
    lines: 68,
    functions: 62,
    branches: 60,
    statements: 67,
  },
}
```

These are ratcheted to measured coverage, not aspirational (see
[Coverage thresholds](#coverage-thresholds)): raise them as coverage grows, never
lower them to admit an untested change.

Run coverage locally: `pnpm test:coverage`

CI runs this on every PR and the thresholds are merge-gating.

---

### Running Cypress locally

1. Build and start the app, with `DATABASE_URL` and `ENCRYPTION_KEY` exported as for the integration tests (`node dist/index.js` does not read `.env`) and the schema pushed:
   ```bash
   pnpm run build
   NODE_ENV=test ALLOW_DEV_AUTH_BYPASS=true node dist/index.js
   ```
2. In a separate terminal:
   ```bash
   pnpm exec cypress open
   ```

---

## Test File Organization

### Directory structure

```
project-root/
  vitest.config.ts                    # Unit test configuration
  vitest.setup.ts                     # Unit test global setup
  vitest.integration.config.ts        # Integration test configuration
  vitest.integration.setup.ts         # Integration test global setup
  vitest.smoke.config.ts              # Production smoke test configuration
  cypress.config.ts                   # Cypress E2E configuration

  shared/
    schema.test.ts                    # Zod schema validation tests
    unitConversion.test.ts            # Unit conversion utility tests

  server/
    clerkAuth.test.ts                 # Auth middleware tests
    crypto.test.ts                    # Encryption utility tests
    emailScheduler.test.ts            # Email scheduler tests
    emailTemplates.test.ts            # Email template tests
    gemini.test.ts                    # Gemini AI client tests
    routeUtils.test.ts               # Route utility tests
    strava.test.ts                    # Strava integration tests
    types.test.ts                     # Type helper tests
    gemini/
      chatService.test.ts            # AI chat service tests
      exerciseParser.test.ts         # AI exercise parser tests
      exerciseParser.image.test.ts   # AI image parser tests
      suggestionService.test.ts      # AI suggestion tests
    routes/
      __tests__/                     # Route unit tests (mocked dependencies)
        testUtils.ts                 # Shared test app factory
        ai.test.ts
        analytics.test.ts
        auth.test.ts
        coaching.test.ts
        email.test.ts
        plans.test.ts
        preferences.test.ts
        workouts.test.ts
      tests/                         # Integration tests (real database) + smoke test
        smoke.test.ts                # Production smoke test (spawns the built server)
        helpers.ts                   # Integration test setup helper
        api.integration.test.ts
        post-migration.integration.test.ts
    services/
      aiEval.test.ts                 # AI evaluation tests
      aiService.test.ts              # AI service tests
      analyticsService.test.ts       # Analytics calculations
      coachService.*.test.ts         # Coaching service behavior groups
      coachService.testSetup.ts      # Coaching service test harness
      exportService.test.ts          # CSV/JSON export tests
      planService.test.ts            # Training plan tests
      ragService.test.ts             # RAG service tests
      stravaMapper.test.ts           # Strava data mapping tests
      workoutService.test.ts         # Workout CRUD tests
      ai/
        coachingInsights.test.ts     # RPE trend, plan phase, station gaps, progression
        trainingStats.test.ts        # Training-context stats aggregation
        mafTrend.test.ts             # MAF trend summary
        testFixtures.ts              # Shared makeExerciseSet / makeTimelineEntry factories
      racePrediction/
        featureBuilder.test.ts       # Race-prediction feature extraction
        racePredictionService.test.ts # End-to-end prediction service
        ranking.test.ts              # Cohort percentile ranking
      workoutService/
        structure.test.ts            # Workout structure helpers (pure + guard branches)
        assignWorkoutPlanDay.test.ts # Plan-day linking + adherence
    storage/
      __tests__/
        plans.test.ts                # Plan storage tests
        workouts.test.ts             # Workout storage tests
      users.test.ts                  # User storage tests
    utils/
      sanitize.test.ts               # Input sanitization tests

  client/src/
    components/
      OnboardingWizard.test.tsx       # Onboarding wizard tests
      __tests__/
        ChatMessage.test.tsx          # Chat message component
        RpeSelector.a11y.test.tsx     # RPE selector accessibility
      timeline/
        __tests__/
          TimelineFilters.test.tsx    # Timeline filter component
    hooks/
      __tests__/
        useChatSession.test.tsx       # Chat session hook
        useCombineWorkouts.test.tsx   # Combine workouts hook
        usePlanImport.test.tsx        # Plan import hook
        useTimelineFilters.test.ts    # Timeline filters hook
        useUnitPreferences.test.tsx   # Unit preferences hook
        useVoiceInput.test.ts         # Voice input hook
        useWorkoutActions.test.tsx    # Workout actions hook
        useWorkoutEditor.test.ts      # Workout editor hook
        useWorkoutForm.test.tsx       # Workout form hook
    lib/
      api/
        client.test.ts               # API client tests
        workouts.test.ts             # Workouts API tests
      authUtils.test.ts              # Auth utility tests
      dateUtils.test.ts              # Date utility tests
      exerciseUtils.test.ts          # Exercise utility tests
      exerciseWarnings.test.ts       # Exercise warnings tests
      queryClient.test.ts            # React Query client tests
      statsUtils.test.ts             # Statistics utility tests
      utils.test.ts                  # General utility tests
    test/
      factories/                     # makeExerciseSet / makeTimelineEntry / makeFood
      support/                       # Shared mocks and render harnesses

  cypress/
    e2e/                             # E2E spec files
      analytics.cy.ts
      api-validation.cy.ts
      coach-chat.cy.ts
      emom-rollout-config.cy.ts
      landing.cy.ts
      log-workout.cy.ts
      log-workout-submission.cy.ts
      navigation.cy.ts
      onboarding.cy.ts
      plan-generation.cy.ts
      settings.cy.ts
      timeline.cy.ts
    support/
      commands.ts                    # Custom Cypress commands (getBySel, ensureConsentDismissed, log-workout stepper helpers)
      e2e.ts                         # Global hooks and Clerk intercepts
      authIntercepts.ts              # API stub helper for authenticated tests
      logWorkoutHelpers.ts           # Log-workout parse/save stubs and page visit
test/
  factories.ts                       # Shared createMock* builders
  audit/
    criticals.audit.test.ts          # Characterisation tests for the calculation audit
  build/                             # Bundle-check, font-asset and service-worker caching tests
  docs/
    docsSync.test.ts                 # Pins doc catalogues to the code they enumerate
  evals/
    chatScenarios.ts                 # Golden chat conversations and their criteria
    chatScenarios.eval.test.ts       # Live run with an LLM judge (RUN_AI_EVAL=true)
    judge.ts / runChatScenario.ts    # The judge, and asking the coach as the route would
```

### Conventions

- **Co-located tests:** Utility and service files place their `.test.ts` file alongside the source file (e.g., `server/crypto.ts` and `server/crypto.test.ts`).
- **`__tests__/` directories:** Used when a directory contains multiple test files for a module group (e.g., `server/routes/__tests__/`, `client/src/hooks/__tests__/`).
- **Integration tests:** Named with the `.integration.test.ts` suffix and excluded from the unit test config.
- **Cypress specs:** Named with the `.cy.ts` suffix in `cypress/e2e/`.
- **Test data factories:** Builders take a partial `overrides` object over sensible defaults. Shared ones live in `test/factories.ts` (`createMockUser()`, `createMockWorkoutLog()`, `createMockTimelineEntry()`, `createMockTrainingPlan()`, `createMockPlanDay()`, `createMockTrainingContext()` and others), `client/src/test/factories/` (`makeExerciseSet()`, `makeTimelineEntry()`, `makeFood()`) and `server/services/ai/testFixtures.ts`; a builder only one file needs, such as `makeSet()` in `analyticsService.test.ts`, stays at the top of that file.
- **Client test support:** `client/src/test/support/` holds shared mocks and render harnesses for component and hook tests (for example `renderWithClient()`, `createWrapper()` and `makeToastMock()` in `mutationHookMocks.tsx`, `installRadixPointerMocks()`, `mockDeviceTimezone()`).
- **`data-testid` attributes:** Used in React components for Cypress selectors via `cy.getBySel()`.

---

See also: [Server -- Route Registration](server.md#route-registration), [Database -- Storage Layer](database.md#storage-layer)
