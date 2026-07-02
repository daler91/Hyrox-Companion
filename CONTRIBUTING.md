# Contributing to fitai.coach

Thanks for your interest in improving fitai.coach. This guide covers local setup,
the checks to run before opening a pull request, and the conventions the project follows.

## Local setup

See [Getting Started](README.md#getting-started) in the README for the full walkthrough.
The short version:

```bash
cp .env.example .env          # set at least DATABASE_URL and ENCRYPTION_KEY
pnpm install
pnpm run db:migrate
pnpm dev                      # client + API on http://localhost:5000
```

For local development without Clerk, set `ALLOW_DEV_AUTH_BYPASS=true` in `.env`.
See [`docs/env-reference.md`](docs/env-reference.md) for the full environment-variable reference.

## Making a change

1. Fork the project and create a feature branch.
2. Make the smallest focused change that solves the problem. Match the style, naming, and
   structure of the surrounding code.
3. Add or update tests for the behavior you change (see [Testing](#testing)).
4. Update documentation when behavior changes (see [Documentation](#documentation)).
5. Run the checks below and make sure they pass.
6. Open a pull request describing the behavior change, how you verified it, and any
   remaining risks.

## Required checks

Run these locally before pushing; they also run in CI:

| Command             | Purpose                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `pnpm check`        | TypeScript type checking                                                     |
| `pnpm test`         | Vitest unit/component/route suite (includes `jest-axe` accessibility checks) |
| `pnpm lint`         | ESLint                                                                       |
| `pnpm format:check` | Prettier formatting check (use `pnpm format` to fix)                         |

Useful additional suites when relevant to your change:

- `pnpm test:smoke` — fast route-registration smoke test for quick pre-push feedback.
- `pnpm exec vitest run --config vitest.integration.config.ts` — integration tests (require PostgreSQL).
- `pnpm exec cypress run` — end-to-end tests.

Pull requests are also gated by **SonarQube Cloud**: keep new-code duplication under
3% (extract shared test fixtures into a `testFixtures.ts` module rather than
copy-pasting large factory objects across suites) and avoid commented-out code.

See [`docs/testing.md`](docs/testing.md) for the full testing guide, including the local
database requirements, the [SonarCloud quality gate](docs/testing.md#sonarcloud-quality-gate),
and Cypress conventions.

## Code style

- **TypeScript** throughout, in strict mode. Prefer the shared types in `shared/schema/`
  over redefining shapes on the client or server.
- **Formatting** is enforced by Prettier and **linting** by ESLint — do not hand-fight them;
  run `pnpm format` and `pnpm lint:fix`.
- **Validation** uses Zod (`shared/schema/zod.ts`); validate request bodies at the route boundary.
- Keep imports sorted as the existing ESLint config expects.

## Database changes

When you change `shared/schema/tables.ts`, generate and commit a migration:

```bash
pnpm run db:generate   # creates the next migrations/NNNN_*.sql + meta snapshot
pnpm run db:migrate    # applies it locally
pnpm run db:check      # validates migration/schema consistency (also gated in CI)
```

Commit the generated `migrations/` files together with the schema change.

For hand-written migrations (data backfills, custom SQL that `db:generate` can't
express), scaffold with:

```bash
pnpm drizzle-kit generate --custom --name=my_migration_name
```

This creates an empty `migrations/NNNN_*.sql` to fill in **plus** the meta
snapshot, keeping the snapshot chain in `migrations/meta/` complete. Never add
a `.sql` file by hand without its snapshot — five historical migrations did,
and their snapshots had to be backfilled later.

## Documentation

Update the relevant docs when your change affects public behavior or setup:

- Public API changes → [`docs/api-reference.md`](docs/api-reference.md), and regenerate the
  OpenAPI snapshot with `pnpm docs:openapi` (the Build workflow fails if
  [`docs/openapi.json`](docs/openapi.json) drifts from the generated spec).
- Schema/storage changes → [`docs/database.md`](docs/database.md).
- New jobs, crons, or integrations → [`docs/integrations.md`](docs/integrations.md).
- Client/state changes → [`docs/client.md`](docs/client.md) / [`docs/state-management.md`](docs/state-management.md).

When a user-facing feature changes, also update the [README](README.md) feature list.

## Reporting issues

For accessibility issues, include the page, browser, assistive technology, expected behavior,
and actual behavior. For security issues, please avoid filing a public issue with exploit
details — report privately to the maintainers.
