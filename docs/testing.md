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
7. [CI/CD Test Workflows](#cicd-test-workflows)
8. [Running Tests](#running-tests)
9. [Test File Organization](#test-file-organization)

---

## Overview

The project follows a testing pyramid with three layers:

- **Unit tests (Vitest)** -- Fast, isolated tests for services, utilities, schema validation, React components, and hooks. These form the bulk of the test suite.
- **Integration tests (Vitest, separate config)** -- Tests that exercise API routes against a real PostgreSQL database with the full Express app wired up.
- **End-to-end tests (Cypress)** -- Browser-based tests that verify complete user flows against a running server.

### Test counts (approximate)

| Layer | Count | Location |
|-------|-------|----------|
| Unit/component/route tests (Vitest) | 184 files | `client/src`, `server`, and `shared` `*.test.{ts,tsx}` files, excluding `*.integration.test.ts` and `*.smoke.test.ts` |
| Integration tests | 2 files | `server/routes/tests/*.integration.test.ts` |
| Smoke tests | 1 file | `server/routes/__tests__/routeRegistration.smoke.test.ts` — run as `pnpm test:smoke` for fast pre-push feedback |
| Cypress E2E specs | 12 files | `cypress/e2e/*.cy.ts` |

The exact Vitest assertion count changes frequently as review-fix branches land.
Use `rg --files -g "*.test.ts" -g "*.test.tsx"` for a current total test-file count, and add `-g "!*.integration.test.ts" -g "!*.smoke.test.ts"` when you need the unit/component/route count.

### Coverage thresholds

All four coverage metrics are configured at **80%** via `@vitest/coverage-v8`
for explicit coverage runs. Normal CI currently runs `pnpm test` without
coverage collection.

- Lines: 80%
- Functions: 80%
- Branches: 80%
- Statements: 80%

---

## Vitest Setup

### Unit test configuration (`vitest.config.ts`)

```ts
// Key settings:
plugins: [react()]                        // @vitejs/plugin-react for JSX/TSX
environment: 'jsdom'                      // DOM simulation for component tests
setupFiles: ['./vitest.setup.ts']         // Global setup
globals: true                             // describe/it/expect available globally
exclude: ['**/*.integration.test.ts', ...] // Integration tests run separately
```

**Path aliases** mirror the Vite dev config:

| Alias | Resolves to |
|-------|-------------|
| `@` | `client/src` |
| `@shared` | `shared` |

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
include: ['**/*.integration.test.ts']  // Only integration test files
environment: 'node'                     // No jsdom -- server-side only
setupFiles: ['./vitest.integration.setup.ts']
fileParallelism: false                  // Sequential execution to avoid DB conflicts
```

The integration setup file (`vitest.integration.setup.ts`) deletes Clerk env vars so the app falls back to dev auth bypass, and falls back to a dummy `DATABASE_URL` when none is provided by CI.

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

### Schema validation tests

Zod schemas are tested by calling `.safeParse()` with valid and invalid payloads and asserting on `result.success` and error messages.

Example (`shared/schema.test.ts`):

```ts
it("rejects a very large csvContent", () => {
  const result = importPlanRequestSchema.safeParse(payload);
  expect(result.success).toBe(false);
  expect(result.error.errors[0].message).toBe("CSV content must be 100,000 characters or less");
});
```

### Utility tests

Utility functions in `client/src/lib/` and `server/utils/` are tested with straightforward input/output assertions. Files include `dateUtils.test.ts`, `exerciseUtils.test.ts`, `statsUtils.test.ts`, `sanitize.test.ts`, and others.

### Mocking patterns

- **`vi.mock()`** -- Used at the module level to replace imports (storage, services, auth middleware).
- **`vi.fn()`** -- Creates mock functions for individual spies.
- **`vi.mocked()`** -- Provides typed access to mocked functions for assertions.
- **`vi.clearAllMocks()`** -- Called in `beforeEach` to reset mock state between tests.

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
- `client/src/components/coach/__tests__/SuggestionCard.a11y.test.tsx`

Adding a new a11y test is part of the PR checklist for any user-facing component change. The tests run as part of the normal `pnpm test` Vitest pool — there is no separate command or workflow.

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

**Common mocking targets:**

- `../../clerkAuth` -- Replaces `isAuthenticated` middleware to inject a test user (`req.auth = { userId: "test_user_id" }`)
- `../../types` -- Mocks `getUserId()` to return the test user ID
- `../../storage` -- Mocks database storage functions
- `../../services/*` -- Mocks service-layer functions
- `../../queue` -- Mocks the background job queue

**Rate limiting:** `clearRateLimitBuckets()` is called in `beforeEach` to reset rate limit state.

### Full integration tests (`server/routes/tests/`)

Integration tests run against a **real PostgreSQL database** (pgvector/pgvector:pg16 in CI) with the full Express route tree registered.

**Helper setup** (`server/routes/tests/helpers.ts`):

- `setupIntegrationTest()` -- Lifecycle hook that creates the full Express app, clears the database before each test, and inserts a test user (`dev-user`) to satisfy foreign key constraints.
- `clearDatabase()` -- Deletes all rows from `exerciseSets`, `workoutLogs`, `planDays`, `trainingPlans`, and `users` tables.
- Auth bypass via `ALLOW_DEV_AUTH_BYPASS=true` env var and the `dev-user` user ID.

**Integration test files:**

| File | Purpose |
|------|---------|
| `server/routes/tests/api.integration.test.ts` | Tests plans, preferences, timeline, and workout CRUD against a real database |
| `server/routes/tests/post-migration.integration.test.ts` | Verifies database schema correctness after migrations (used in the post-migration workflow) |

---

## Cypress E2E Tests

### Configuration (`cypress.config.ts`)

```ts
projectId: "dy8p9y"              // Cypress Cloud project for recording/parallelism
baseUrl: "http://localhost:5000"  // Local dev server
specPattern: "cypress/e2e/**/*.cy.ts"
supportFile: "cypress/support/e2e.ts"
video: true
screenshotOnRunFailure: true
viewportWidth: 1280
viewportHeight: 720
defaultCommandTimeout: 10000      // 10 seconds
```

### E2E spec files

| Spec file | Coverage area |
|-----------|---------------|
| `cypress/e2e/analytics.cy.ts` | Analytics dashboard |
| `cypress/e2e/api-validation.cy.ts` | API input validation |
| `cypress/e2e/coach-chat.cy.ts` | Coach chat flow |
| `cypress/e2e/emom-rollout-config.cy.ts` | EMOM rollout configuration |
| `cypress/e2e/landing.cy.ts` | Landing/marketing page |
| `cypress/e2e/log-workout.cy.ts` | Workout logging form |
| `cypress/e2e/log-workout-submission.cy.ts` | Workout form submission |
| `cypress/e2e/navigation.cy.ts` | Sidebar navigation, routing, 404 |
| `cypress/e2e/onboarding.cy.ts` | Onboarding flow |
| `cypress/e2e/plan-generation.cy.ts` | AI plan generation flow |
| `cypress/e2e/settings.cy.ts` | Settings page |
| `cypress/e2e/timeline.cy.ts` | Timeline view |

### Support files

**`cypress/support/e2e.ts`** -- Global setup:

- Imports custom commands from `./commands`.
- Suppresses uncaught exceptions from `clerk.example.com` (Clerk SDK in test mode).
- Intercepts all requests to `https://clerk.example.com/**` with a `200 {}` response in `beforeEach`, preventing Clerk from interfering with tests.

**`cypress/support/commands.ts`** -- Custom commands:

- `cy.getBySel(selector)` -- Shorthand for `cy.get('[data-testid="..."]')`. This is the standard way to select elements in E2E tests.

**`cypress/support/authIntercepts.ts`** -- Authentication bypass:

The `setupAuthIntercepts()` function stubs all authenticated API endpoints so tests can run without a real backend or real auth. It intercepts:

- `GET /api/v1/auth/user` -- Returns a mock user
- `GET /api/v1/preferences` -- Returns default preferences (configurable via `overrides`)
- `GET /api/v1/timeline*`, `GET /api/v1/plans`, `GET /api/v1/workouts*`
- `GET /api/v1/personal-records*`, `GET /api/v1/exercise-analytics*`, `GET /api/v1/training-overview*`
- `GET /api/v1/strava/status`, `GET /api/v1/exercise-history*`, `GET /api/v1/custom-exercises*`, `GET /api/v1/chat/history`

All intercepted endpoints return sensible defaults that can be overridden per-test:

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

**File:** `server/routes/__tests__/routeRegistration.smoke.test.ts`

A fast route-registration smoke test that imports `registerRoutes`, mounts it on a bare Express app, and asserts the route tree wires up correctly (for example, that the workouts router is mounted exactly once). All sub-routers, auth setup, and CSRF middleware are mocked, so the test runs quickly without a real server, database, or build step.

### Configuration

The smoke test uses a **separate Vitest config** (`vitest.smoke.config.ts`):

- Included only via the `**/smoke.test.ts` glob; excluded from the standard unit test suite
- Uses `node` environment (no jsdom)
- Shares the integration setup file (`vitest.integration.setup.ts`)
- Runs with `fileParallelism: false`
- Runs as its own step in the Cypress workflow (`cypress.yml`)

### What's Tested

- `registerRoutes()` mounts each sub-router on the Express app
- The workouts router is mounted exactly once (no duplicate registration)

### Running Smoke Tests

```bash
pnpm test:smoke
# equivalent to:
pnpm exec vitest run --config vitest.smoke.config.ts
```

---

## CI/CD Test Workflows

All workflows are in `.github/workflows/` and run on GitHub Actions with Ubuntu runners. Node-based workflows use Node.js 20 via pnpm.

### 1. Unit Tests (`test.yml`)

- **Name:** Unit Tests
- **Triggers:** Push to `main`, pull request (opened/synchronize/reopened)
- **Steps:** Checkout, install pnpm + Node.js 20, `pnpm install`, `pnpm test`
- **Environment:** Dummy values for `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY`

### 2. Cypress Tests (`cypress.yml`)

- **Name:** Cypress Tests
- **Triggers:** Every push
- **Services:** PostgreSQL (pgvector/pgvector:pg16) on port 5432
- **Parallelism:** Matrix strategy with 2 containers for parallel Cypress runs
- **Steps:**
  1. Install dependencies and Cypress binary (cached)
  2. Build the application (`pnpm run build`)
  3. Enable pgvector extension
  4. Run integration tests: `pnpm exec vitest run --config vitest.integration.config.ts`
  5. Push database schema with `drizzle-kit push`
  6. Run the smoke test: `pnpm exec vitest run --config vitest.smoke.config.ts`
  7. Start the built server in test mode (`NODE_ENV=test`, `ALLOW_DEV_AUTH_BYPASS=true`)
  8. Wait for server health check at `/api/v1/health`
  9. Run Cypress, recording to Cypress Cloud only when `CYPRESS_RECORD_KEY` is set

### 3. Check Migrations (`migrations.yml`)

- **Name:** Check Migrations
- **Triggers:** Push to `main`, pull request
- **Steps:** Runs `pnpm run db:check` for internal consistency, then `pnpm run db:generate` followed by `git diff --exit-code migrations/` to verify migrations are up to date with the schema.

### 4. Post-Migration Verification (`post-migration.yml`)

- **Name:** Post-Migration Verification
- **Triggers:** Manual (`workflow_dispatch`)
- **Steps:** Applies migrations to Neon database via `pnpm run db:migrate`, then runs `post-migration.integration.test.ts` against the real Neon database to verify schema correctness.

### 5. Build (`build.yml`)

- **Name:** Build
- **Triggers:** Push to `main`, pull request
- **Purpose:** ESLint, TypeScript, and OpenAPI snapshot drift checks. SonarQube Cloud automatic analysis is configured outside these manual workflow steps.

### 6. Other workflows

- **DevSkim** (`devskim.yml`) -- Static security analysis
- **Bearer** (`bearer.yml`) -- Static security and privacy analysis
- **Dependency Review** (`dependency-review.yml`) -- Reviews dependency changes in PRs

---

## Code Review Skill Profiles

The `.claude/commands/review/` directory contains structured code-review prompts ("skill profiles") that frame a walkthrough of the codebase from a specific role's perspective. They complement automated tests by surfacing issues that linters and unit tests miss — architectural drift, UX regressions, privacy gaps, and so on.

| Profile | File | Role |
|---|---|---|
| `security` | `.claude/commands/review/security.md` | Senior security auditor — vulnerabilities, exposed secrets, auth gaps |
| `privacy` | `.claude/commands/review/privacy.md` | Data privacy officer — collection, storage, transmission, retention, compliance |
| `ux` | `.claude/commands/review/ux.md` | UX / accessibility expert — usability, flow, responsiveness, WCAG compliance |
| `performance` | `.claude/commands/review/performance.md` | Performance engineer — bottlenecks, memory leaks, optimization opportunities |
| `business` | `.claude/commands/review/business.md` | Business analyst — requirements, logic, business-value alignment |
| `qa` | `.claude/commands/review/qa.md` | QA engineer — edge cases, race conditions, failure modes |
| `devops` | `.claude/commands/review/devops.md` | DevOps engineer — deployment readiness, error handling, logging, infra |
| `all` | `.claude/commands/review/all.md` | Runs every profile and produces a unified report |

Invoke a profile inside Claude Code with `/review:<profile>` (for example, `/review:security` or `/review:all`). Each profile defines the review scope, the output format, and the severity bands — so repeated runs produce comparable reports.

---

## Running Tests

### Commands

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all unit tests once (`vitest run`) |
| `pnpm test:watch` | Run unit tests in watch mode (`vitest`) |
| `pnpm exec vitest run --config vitest.integration.config.ts` | Run integration tests (requires a running PostgreSQL database) |
| `pnpm exec cypress open` | Open Cypress interactive runner (requires the app running on port 5000) |
| `pnpm exec cypress run` | Run Cypress tests headlessly |

### Coverage reporting

To generate a coverage report, run:

```bash
pnpm exec vitest run --coverage
```

This uses `@vitest/coverage-v8` and enforces the 80% thresholds defined in `vitest.config.ts` for that coverage run. If any metric falls below 80%, the coverage command will fail.

### Running integration tests locally

Integration tests require a real PostgreSQL database. Set the following environment variables:

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/testdb"
export ALLOW_DEV_AUTH_BYPASS="true"
export ENCRYPTION_KEY="01234567890123456789012345678901"
```

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

- **Timezone issues**: CI runs in UTC. Use `toDateStr()` helper instead of `new Date().toISOString()` for date comparisons.
- **Rate limiting**: Tests that hit the same endpoint rapidly may trigger rate limits. Use `clearRateLimitBuckets()` from `server/routeUtils.ts` in `beforeEach`.
- **Database state**: Integration tests share a real database. Always use `clearDatabase()` in setup. Check for leaked state from parallel test runs.
- **Missing env vars**: CI may not have all optional env vars. Tests that depend on `GEMINI_API_KEY` should be conditional or mocked.

---

## Coverage Enforcement

Coverage thresholds are configured in `vitest.config.ts`:

```typescript
coverage: {
  provider: "v8",
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  }
}
```

Run coverage locally: `pnpm exec vitest run --coverage`

CI does not run coverage by default. Add an explicit coverage workflow or step before treating these thresholds as merge-gating.

---

### Running Cypress locally

1. Build and start the app:
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
        routeRegistration.smoke.test.ts  # Route-registration smoke test
      tests/                         # Integration tests (real database)
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
        ExerciseInput.test.tsx        # Exercise input component
        RpeSelector.a11y.test.tsx     # RPE selector accessibility
      timeline/
        __tests__/
          TimelineFilters.test.tsx    # Timeline filter component
    hooks/
      __tests__/
        useBlockCounts.test.ts        # Block counts hook
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
      commands.ts                    # Custom Cypress commands (getBySel)
      e2e.ts                         # Global hooks and Clerk intercepts
      authIntercepts.ts              # API stub helper for authenticated tests
```

### Conventions

- **Co-located tests:** Utility and service files place their `.test.ts` file alongside the source file (e.g., `server/crypto.ts` and `server/crypto.test.ts`).
- **`__tests__/` directories:** Used when a directory contains multiple test files for a module group (e.g., `server/routes/__tests__/`, `client/src/hooks/__tests__/`).
- **Integration tests:** Named with the `.integration.test.ts` suffix and excluded from the unit test config.
- **Cypress specs:** Named with the `.cy.ts` suffix in `cypress/e2e/`.
- **Test data factories:** Helper functions like `makeSet()` and `makeWorkoutLog()` are defined at the top of test files to build test data with sensible defaults and per-test overrides.
- **`data-testid` attributes:** Used in React components for Cypress selectors via `cy.getBySel()`.

---

See also: [Server -- Route Registration](server.md#route-registration), [Database -- Storage Layer](database.md#storage-layer)
