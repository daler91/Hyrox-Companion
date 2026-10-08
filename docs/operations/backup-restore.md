# Backup, Restore & Disaster Recovery Runbook

> Addresses review finding **W22** (no documented backup / PITR / DR runbook).
> Owner: on-call / platform. Review cadence: quarterly, plus after any schema or
> hosting change.

## 1. Topology

| Datastore | Role | Hosting | Connection |
|-----------|------|---------|------------|
| Primary Postgres | Source of truth — users, workouts, plans, chat, connections (encrypted) | Railway managed Postgres (internal `*.railway.internal` host, private IPv6, no SSL) | `DATABASE_URL` |
| Vector DB (optional) | RAG `document_chunks` + `food_embeddings` | Separate pgvector instance (e.g. Neon) or the primary DB in single-DB mode | `VECTOR_DATABASE_URL` (falls back to `DATABASE_URL`) |

The vector DB is **derived data**: every chunk can be re-embedded from the
`coaching_materials` rows in the primary DB. It is therefore lower-criticality
than the primary DB — losing it costs an embedding re-run, not user data. §5.3
is the rebuild procedure.

### 1.1 What boot does and does not repair

This section is load-bearing for every restore below, and the two datastores
behave differently. Read it before assuming a redeploy will fix anything.

**Primary DB — boot repairs nothing, and will refuse to serve.**
`runDrizzleMigrations()` (`server/maintenance.ts`) is strict: a migration error
that is not an idempotency error aborts startup, sets `startupState.startupError`,
and both health endpoints go 503, so the deploy fails Railway's readiness
healthcheck and the previous deployment keeps serving. Serving traffic against
a schema whose migration just failed — worst case, an empty database — is
strictly worse than a blocked deploy. A restore
whose schema does not match the deployed code therefore blocks the deploy; it
does not heal.

**Production applies its migrations at boot.** `migrate()` runs every journal
entry newer than the newest row in `drizzle.__drizzle_migrations`, schema and
data statements alike, in one transaction. Production's ledger is populated
(one row per journal entry; confirmed 2026-10-07). An earlier revision of this
section said production was managed by a hand-run `drizzle-kit push` with an
empty ledger; that was never true. **Never run `drizzle-kit push` against
production**: it drops objects the schema does not declare (0036's
`data_remediation_log` and its view, 0074's trigram indexes). Consequences
during recovery:

- A restore carries its ledger with it, so the first boot applies every
  migration newer than the backup. A restore with a ledger but **no schema**
  (a data-only dump into a database whose ledger rows survived) is the one
  shape boot cannot heal: `migrate()` sees nothing to do. Restore schema and
  ledger together, from the same dump.
- An **empty** database (no ledger) is built by the first boot from 0000.
  Load a data-only dump only after that boot has created the schema.
- The migrator skips any journal entry whose `when` is older than the newest
  recorded row. 0019 was skipped that way until 2026-10-07
  ([`pending-manual-steps.md`](./pending-manual-steps.md)). Boot logs any such
  entry by name, and the startup check names it in its error.
- Steps no migration carries (scripts, hand-written SQL) are run-once
  checkboxes in [`pending-manual-steps.md`](./pending-manual-steps.md). A
  restore is as old as its backup, so one ticked after the backup was taken
  must be run again. The restore drill in §6 checks the known data states.

**Vector DB — structure genuinely is self-created.** `ensureVectorSchema()`
creates `document_chunks` and `food_embeddings`, their btree indexes, and both
halfvec HNSW indexes, idempotently, on every boot. A vector restore needs no
SQL beyond `CREATE EXTENSION vector`. It is deliberately best-effort: it
swallows its own errors so a vector-DB problem cannot block a deploy. The
outcome is reported as `vectorSchema` on `/api/v1/health` (`pending` / `ok` /
`degraded` / `failed`) and captured to Sentry on failure — **check that field
after a restore**, because the readiness probe only runs `SELECT 1` against the
vector pool, which a reachable-but-empty database answers happily.

`pnpm ops:reembed` runs the same schema setup, so an operator can provision and
rebuild the vector DB without booting the app at all.

## 2. Recovery objectives

| Target | Value | Rationale |
|--------|-------|-----------|
| RPO (max data loss) | **≤ 24h** from daily snapshots; **≤ 5 min** if PITR/WAL is enabled on the provider | Workout/chat data is valuable but not financial; tighten if the plan supports PITR |
| RTO (max downtime) | **≤ 1h** for primary DB restore | Single-service app; restore + redeploy is the long pole |
| Vector DB RTO | Best-effort | Rebuildable by re-embedding; not on the critical path |

These are **targets, not measurements** — they have never been validated
against the Railway/Neon plan actually in use. Two things make them real:
confirm the provider's snapshot schedule and retention (§3.1) and record them
here, and run the drill (§6), whose wall-clock output is the only evidence the
RTO is achievable.

## 3. Backup strategy

### 3.1 Primary DB (Railway Postgres)
1. **Provider snapshots** — Railway takes automated backups of the Postgres
   volume; retention depends on the plan. Confirm the schedule and retention in
   the Railway dashboard (Postgres service → Backups) and record them here.
2. **Off-platform logical backup (recommended)** — a scheduled `pg_dump` to
   storage outside Railway guards against an account/provider-level failure that
   a provider snapshot cannot. Run from a network that can reach the **external**
   DB hostname (the internal `*.railway.internal` host is only reachable from
   inside Railway and speaks no SSL):

   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     "$DATABASE_URL_EXTERNAL" > "fitai-$(date -u +%Y%m%dT%H%M%SZ).dump"
   # then upload the .dump to off-site object storage (S3/GCS/B2) with
   # server-side encryption and a 30-day lifecycle policy.
   ```

   Take the **schema too** — the default here does, and §1.1 explains why a
   data-only dump cannot be recovered from.

### 3.2 Encryption key escrow — required, not optional

The dump contains Strava and Garmin credentials encrypted with AES-256-GCM
(`server/crypto.ts`). Without the matching `ENCRYPTION_KEY` those columns are
unrecoverable ciphertext: every athlete has to disconnect and reconnect both
integrations by hand.

- Store `ENCRYPTION_KEY` (and `ENCRYPTION_KEY_V2` while a rotation is in
  flight) in a secret manager **separate from the backup storage**, so neither
  the dumps nor the key store alone is sufficient.
- Record *where* it lives here, in prose — not the value:
  _escrow location: **not yet recorded**._
- Escrow the key for as long as the oldest retained backup. A key rotated and
  discarded before its backups expire silently bricks them; §6's decrypt check
  is what catches that while it is still fixable.

### 3.3 Vector DB
If hosted on Neon, rely on Neon's automated backups + PITR window. Otherwise it
is acceptable to skip backups entirely and rebuild by re-embedding (§5.3).

## 4. Restore — primary DB

1. **Provision / select the target.** Restore into a fresh Railway Postgres
   service (preferred — keeps the damaged instance for forensics) or an empty DB.
2. **Restore data.**
   - From a provider snapshot: use the Railway dashboard restore flow.
   - From a `pg_dump` custom-format dump:
     ```bash
     pg_restore --no-owner --no-privileges --clean --if-exists \
       --dbname "$TARGET_DATABASE_URL" fitai-<timestamp>.dump
     ```
     Avoid `--disable-triggers` unless you have no alternative: it suppresses FK
     enforcement during load and can leave orphaned rows behind. §6's drill
     detects exactly that.
3. **Confirm the schema is complete before pointing the app at it.** Run the
   drill (§6) against the restored database. If it reports missing tables
   alongside a populated ledger, the dump was data-only: restore the schema
   and ledger from a full dump (§1.1). Do not reach for `drizzle-kit push`.
4. **Point the app at the restored DB.** Update `DATABASE_URL` on the service.
   Keep `ENCRYPTION_KEY` (and `ENCRYPTION_KEY_V2` if mid-rotation) identical to
   the source, or every stored credential becomes undecryptable.
5. **Redeploy and verify.** `/api/v1/health` must return `status: "ok"`. Check
   `vectorSchema` in the same payload — it is reported but does not gate
   readiness, so a `failed` there is a green health check with RAG and semantic
   food search dead (§5).
6. **Work the outstanding data steps.** Re-check
   [`pending-manual-steps.md`](./pending-manual-steps.md): a restored database
   is as old as its backup, so a step ticked after that backup was taken has
   been rolled back and must be run again.

## 5. Restore — vector DB

1. If a vector backup exists, restore it the same way as the primary DB.
2. **pgvector must exist before restore.** The app runs
   `CREATE EXTENSION IF NOT EXISTS vector` on boot, but a manual restore into a
   bare DB needs the extension first: `CREATE EXTENSION IF NOT EXISTS vector;`
   (pgvector ≥ 0.7.0 — below that the halfvec HNSW indexes cannot be created and
   vector search degrades to a sequential scan, which `vectorSchema: "degraded"`
   reports).
3. **Rebuild instead of restore (fallback).** With the primary DB intact:

   ```bash
   pnpm ops:reembed --verify-only   # does this restore even need a rebuild?
   pnpm ops:reembed                 # provision schema + re-embed every athlete
   ```

   Requires `GEMINI_API_KEY` and, when split, `VECTOR_DATABASE_URL`. It
   provisions the vector schema itself, walks every athlete who owns coaching
   materials, and exits non-zero if any material still has no chunks afterwards.
   Dropping `document_chunks` first is **not** required: each material's chunks
   are replaced transactionally, so an interrupted run is safe to repeat.
   `--user <id>` restricts it to one athlete; `--dry-run` writes nothing.

## 6. Restore-drill cadence & verification

Run a **monthly** restore drill into a throwaway service (never into prod):

```bash
RESTORE_DRILL_DATABASE_URL=postgres://... ENCRYPTION_KEY=... pnpm ops:restore-drill
```

Automated by that command — exit code 0 only if all of them pass:

- [x] Latest backup restores without error (it connects and answers).
- [x] Migration ledger matches the Drizzle journal. A production restore
      passes. An empty ledger is a `warn` with the reason: the shape of a
      database built by `drizzle-kit push`, such as a CI copy (§1.1). A
      *partially* applied ledger is reported as a failure: the restore
      predates the deployed code, and the first boot will apply the rest.
- [x] Every table the deployed code expects exists. This holds however the
      schema was built.
- [x] Row-count spot checks on `users`, `workout_logs`, `training_plans`. An
      empty `users` fails: schema restored, dump never loaded.
- [x] FK integrity — a generic orphan sweep over every foreign key in the
      catalog, so new tables are covered without touching the script.
- [x] The known ownerless-row shapes, which doubles as verification for the
      outstanding DELETEs in [`pending-manual-steps.md`](./pending-manual-steps.md).
- [x] A stored Strava credential **decrypts** with the supplied `ENCRYPTION_KEY`
      (proves key + ciphertext integrity — see §3.2). Skipped, not failed, when
      no key is exported.

Still manual, and still part of the drill:

- [ ] App boots against the restored DB and `/api/v1/health` returns `ok` with
      an acceptable `vectorSchema`.
- [ ] Spot-check a restored athlete's timeline in the UI.
- [ ] Record the run below: date, operator, wall-clock time, and how that
      compares against the §2 RTO. An undated drill is not evidence.

| Date | Operator | Wall clock | Result | Notes |
|------|----------|-----------|--------|-------|
| _none recorded yet_ | | | | |

## 7. Related

- `server/db.ts` — primary pool + internal-host SSL handling.
- `server/vectorDb.ts` — vector pool / single-DB fallback.
- `server/maintenance.ts` — boot-time migrations, `ensureVectorSchema()`, and
  the `vectorSchema` status reported on the readiness probe.
- `server/migrationGuards.ts` — which migration errors count as benign, and the
  critical-table assertion that gates readiness.
- `server/crypto.ts` — at-rest credential encryption + key rotation (`docs` and
  `.env.example` cover `ENCRYPTION_KEY` / `ENCRYPTION_KEY_V2`).
- `script/restore-drill.ts` — `pnpm ops:restore-drill` (§6).
- `script/reembed-materials.ts` — `pnpm ops:reembed` (§5.3).
- [`pending-manual-steps.md`](./pending-manual-steps.md) — production steps no
  migration carries, and the verification queries for the data migrations.
- `docs/database.md` — schema reference.
