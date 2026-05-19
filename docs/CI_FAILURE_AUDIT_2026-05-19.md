# CI Failure Audit - 2026-05-19

## Current Status

As of May 19, 2026, the latest `main` CI run set is green at commit `b83bf8165ab1a826f6b8157e419d9ee0ab96796d`.

| Workflow         | Latest run                                                            | Status |
| ---------------- | --------------------------------------------------------------------- | ------ |
| Unit Tests       | <https://github.com/daler91/Hyrox-Companion/actions/runs/26101911010> | Passed |
| Build            | <https://github.com/daler91/Hyrox-Companion/actions/runs/26101910902> | Passed |
| Cypress Tests    | <https://github.com/daler91/Hyrox-Companion/actions/runs/26101910900> | Passed |
| Check Migrations | <https://github.com/daler91/Hyrox-Companion/actions/runs/26101910901> | Passed |
| DevSkim          | <https://github.com/daler91/Hyrox-Companion/actions/runs/26101911013> | Passed |
| Bearer           | <https://github.com/daler91/Hyrox-Companion/actions/runs/26101910896> | Passed |
| CodeQL           | <https://github.com/daler91/Hyrox-Companion/actions/runs/26101909930> | Passed |

There were no open PRs during this audit. The checked-out branch at the start of the investigation was the already merged `codex/prevent-repeat-ai-volume-reductions` branch, which was behind `origin/main`; this audit branch was created from latest `origin/main`.

## Failure Classes

| Class                                 | Example run                                                                                                                                  | Current status                | Notes                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flaky UUID assertion                  | <https://github.com/daler91/Hyrox-Companion/actions/runs/25997825498>                                                                        | Live risk fixed in this audit | `client/src/lib/offlineQueue.test.ts` rejected valid UUIDs that started with digits followed by a hyphen. A 100,000 sample check produced this shape about 2.2 percent of the time.                                                                                                                                       |
| Migration drift                       | <https://github.com/daler91/Hyrox-Companion/actions/runs/26000616290>                                                                        | Resolved on current `main`    | The migration check generated `migrations/0049_slimy_sphinx.sql` and changed `migrations/meta/_journal.json`, so CI correctly failed because generated migration output was not committed on that historical branch. Current `main` has the shared runtime state migration committed and the migration workflow is green. |
| DevSkim registry/Docker failure       | <https://github.com/daler91/Hyrox-Companion/actions/runs/26000616287>                                                                        | Mitigated by current workflow | The failing run used the DevSkim Docker action and could not pull `mcr.microsoft.com/dotnet/sdk:8.0` because MCR returned `403 Forbidden`. Current `.github/workflows/devskim.yml` installs the .NET SDK with `actions/setup-dotnet` and runs `Microsoft.CST.DevSkim.CLI`, avoiding that Docker image path.               |
| Cypress selector failure              | <https://github.com/daler91/Hyrox-Companion/actions/runs/25938189660>                                                                        | Historical/resolved           | `log-workout.cy.ts` timed out looking for `[data-testid="structure-blocks-add-emom"]` during the EMOM confirm-step flow. The current Cypress workflow passes on `main`.                                                                                                                                                   |
| Lint/type quality gates               | <https://github.com/daler91/Hyrox-Companion/actions/runs/25934759438>, <https://github.com/daler91/Hyrox-Companion/actions/runs/25910184139> | Historical/resolved           | Examples included unused variables and strict TypeScript ESLint findings such as unsafe assignment or object stringification in in-flight branches. Current Build is green.                                                                                                                                               |
| Plan-generation unit mismatch         | <https://github.com/daler91/Hyrox-Companion/actions/runs/25893448821>                                                                        | Historical/resolved           | A test expected `createPlanDays` to receive a specific normalized payload shape. Current Unit Tests are green.                                                                                                                                                                                                            |
| Timeline rename and query setup tests | Historical review finding in `docs/CODEBASE_REVIEW_2026-05-16.md`                                                                            | Historical/resolved           | The review document notes the original `TimelineFilters` rename failures and a missing preferences query setup, then marks them resolved. A focused local rerun of `TimelineFilters.test.tsx` and `Timeline.missed-routing.test.tsx` passed during this audit.                                                            |

## Live Hardening

`client/src/lib/offlineQueue.test.ts` now mocks `crypto.randomUUID()` to return `24936253-dc1a-4fe1-a481-f33c22053e78`, a valid UUID that starts with digits. The test asserts that exact ID is used and that `Math.random` is not called.

This keeps the original intent, proving the secure browser crypto path is used, while removing the invalid assumption that random UUIDs cannot begin with digits followed by a hyphen.

## Second Audit Pass

A repeat local audit on the same branch reproduced preexisting nondeterminism in the Vitest unit suite, even though current GitHub CI remains green.

| Command                                                   | Result         | Notes                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test -- --reporter=dot`                             | Failed locally | Timed out in `client/src/components/workout-detail/__tests__/ExerciseTable.test.tsx` and `client/src/pages/__tests__/Settings.maf-switch.test.tsx` at Vitest's default 5 second per-test timeout.                                                             |
| `pnpm exec vitest run --reporter=dot --testTimeout=10000` | Failed locally | The original timeout pair passed, but failures shifted to `client/src/hooks/__tests__/usePlanImport.test.tsx` and `client/src/components/timeline/__tests__/TimelineFilters.test.tsx`, which points to load/order sensitivity rather than one broken feature. |
| Focused reruns of the four failing files                  | Passed locally | Each failed case passed when isolated.                                                                                                                                                                                                                        |
| `pnpm run check`, `pnpm run lint`, `pnpm run build`       | Passed locally | The reproduced issue is unit-suite nondeterminism, not TypeScript, lint, or production build drift.                                                                                                                                                           |

This audit hardens the four flaky tests at their async boundaries: post-mutation state, Radix portal/menu item appearance, and post-click modal state. The two UI-heavy tests that can exceed Vitest's default 5 second per-test budget under full Windows-suite load use a local 10 second timeout. It does not change runtime code, global Vitest timeout, worker settings, CI workflows, public APIs, schemas, or migrations.

## Watch Items

- Cypress Cloud emitted a free-plan quota warning in the historical Cypress run, but the run still executed tests and the current Cypress workflow passes. Do not change workflow recording behavior unless quota starts failing current CI.
- The migration workflow is doing the right thing by regenerating Drizzle output and requiring `git diff --exit-code migrations/`. Future schema changes should commit generated migration artifacts in the same PR.
- Build failures in the sampled history were normal quality gates rather than infrastructure failures. Keep treating ESLint and type errors as branch-specific code fixes.
