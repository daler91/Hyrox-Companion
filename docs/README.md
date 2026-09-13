[Back to repo README](../README.md)

# Documentation index

Everything written down about fitai.coach, grouped by what it is good for. **Core reference** and
**Operations** describe the system as it is now and are maintained alongside the code; everything
below them is narrower in scope or fixed in time, and each section says which.

---

## Core reference

The maintained description of how the system works. Start here.

| Document                                  | Covers                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Architecture Guide](architecture.md)     | End-to-end flows, provider layer, service dependencies, RAG decision tree, schema pipeline |
| [Client](client.md)                       | React SPA, routing, components, styling, PWA, client Sentry                                |
| [Server](server.md)                       | Express bootstrap, middleware stack, routes, logging, graceful shutdown                    |
| [Database](database.md)                   | PostgreSQL schema table-by-table, Drizzle ORM, pgvector, migrations, storage layer         |
| [API Reference](api-reference.md)         | Endpoint catalog, request/response shapes, rate limits                                     |
| [Authentication](authentication.md)       | Clerk setup, user sync, dev auth bypass, protected routes                                  |
| [State Management](state-management.md)   | TanStack Query, custom hooks, offline queue, utility functions                             |
| [AI and RAG](ai-and-rag.md)               | Text provider layer, Gemini embeddings/vision, coaching context, RAG pipeline              |
| [Nutrition & Fuelling](nutrition.md)      | Food logging, food search, per-meal fuel targets, AI parsing                               |
| [Integrations](integrations.md)           | Strava, Garmin, Resend, pg-boss queues, cron jobs, Sentry                                  |
| [Testing](testing.md)                     | Vitest, integration tests, Cypress, accessibility checks, CI workflows                     |
| [Environment Variables](env-reference.md) | Every env var, defaults, feature gates, safety invariants                                  |

**Machine-readable:** [`openapi.json`](openapi.json) — OpenAPI 3.0 snapshot, regenerated with
`pnpm docs:openapi` and CI-gated against drift. It covers workout CRUD and preferences only;
`server/routes/` remains the source of truth for the rest.

## Operations

Runbooks for people with production access.

| Document                                                   | Covers                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Backup, Restore & DR](operations/backup-restore.md)       | Backup topology, restore procedure, drill cadence, vector-DB rebuild                                          |
| [Account Erasure](operations/account-erasure.md)           | GDPR Art. 17 deletion runbook, including the separate vector DB                                               |
| [Pending Manual Steps](operations/pending-manual-steps.md) | Data-bearing migrations awaiting a production audit, with per-migration consequences and verification queries |

## Decisions

Architecture decision records — the durable "why", not the current "how".

| Document                                                        | Decides                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [ADR: Units on Stored Numeric Columns](adr-units.md)            | Canonical storage unit per column, and the rule that a column's unit never varies by row |
| [ADR: Canonical Server Startup Pattern](adr-startup-pattern.md) | The phased bootstrap every startup path must follow                                      |

## Specs and feature notes

Scoped to one feature. Accurate for what they cover, but not a description of the whole system.

| Document                                                          | Covers                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| [Coach Memory](coach-memory-spec.md)                              | The durable athlete card fed into coaching context             |
| [Weekly Review](weekly-review-spec.md)                            | Scope and shape of the in-app weekly review                    |
| [AI Coach Auto-Regulation Flow](ai-coach-auto-regulation-flow.md) | How fatigue signals reach a plan adjustment                    |
| [New Training Style Checklist](new-training-style-checklist.md)   | Every place that needs touching when a training style is added |
| [Native Mobile](native-mobile.md)                                 | Capacitor vs. React Native comparison and packaging phases     |

## Brand and design

| Document                                     | Covers                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [Brand Kit](BrandKit/BRAND.md)               | Colour tokens, typography scale, component specs, motion — plus logo assets and the designed PDF in [`BrandKit/`](BrandKit/) |
| [Design Guidelines](../design_guidelines.md) | Higher-level UI approach: layout patterns, screen-by-screen composition                                                      |

## Plans and rollouts

In-flight or completed work. Check the referenced code before trusting a status.

| Document                                                                    | Covers                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------- |
| [React 19 Upgrade Plan](react-19-upgrade-plan.md)                           | `react@18.3.1` → `react@19.2.8` migration plan |
| [Structured Text Optional](migration-readiness-structured-text-optional.md) | Migration-readiness spec and telemetry plan    |
| [`training_styles_v1` Rollout](training-styles-rollout.md)                  | Phased rollout plan for training styles        |

## Registers

Living lists, updated in place rather than superseded.

| Document                                          | Tracks                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| [Product Opportunities](PRODUCT_OPPORTUNITIES.md) | Prioritised new features and improvements, with code-level evidence |
| [Technical Debt](../TECHNICAL_DEBT.md)            | Known debt, with resolved items struck through rather than deleted  |

## Point-in-time reports

**Snapshots, not current state.** Each was accurate on its date; findings may since have been
resolved, superseded, or reworked. They are kept for provenance — several inline code comments
cite a review by filename and finding number. For how the system works _now_, use Core reference
above and the source.

| Document                                                              | Date                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Mapper-Concern Verification](MAPPER_CONCERNS_VERIFIED_2026-09-04.md) | 2026-09-04                                                                                |
| [Codebase Analysis](CODEBASE_ANALYSIS_2026-08-31.md)                  | 2026-08-31                                                                                |
| [Calculation Correctness Audit](CALCULATION_AUDIT_2026-08-20.md)      | 2026-08-20 — pinned by characterisation tests in [`test/audit/`](../test/audit/README.md) |
| [Codebase Analysis](CODEBASE_ANALYSIS_2026-07-19.md)                  | 2026-07-19                                                                                |
| [Codebase Analysis](CODEBASE_ANALYSIS_2026-07-01.md)                  | 2026-07-01                                                                                |
| [Deep Codebase Audit](../CODEBASE_AUDIT.md)                           | undated; content places it around late May 2026                                           |

Older reviews are in [`archived/`](archived/README.md), which carries its own dated index.

## Elsewhere in the repo

| Document                                                    | Covers                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| [Repo README](../README.md)                                 | Features, tech stack, project structure, setup, scripts, CI      |
| [CONTRIBUTING](../CONTRIBUTING.md)                          | Local setup, the typecheck ratchet, conventions, PR expectations |
| [Race benchmarks tool](../script/race-benchmarks/README.md) | Generating and backtesting the race-prediction seed data         |
| [Calculation audit tests](../test/audit/README.md)          | Why those characterisation tests pin current-but-wrong behaviour |

---

## Keeping this honest

Several catalogues in these docs are pinned to the code by `test/docs/docsSync.test.ts`, which goes
red when they drift: pg-boss queues and cron keys against `integrations.md`, env vars against
`env-reference.md`, storage domains and schema tables against `database.md`, CI workflows against
`testing.md`, and every internal link and heading anchor across all markdown in the repo. If you add
a document here, add it to this index too — nothing enforces that one.
