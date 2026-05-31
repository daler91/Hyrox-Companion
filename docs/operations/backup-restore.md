# Backup, Restore & Disaster Recovery Runbook

> Addresses review finding **W22** (no documented backup / PITR / DR runbook).
> Owner: on-call / platform. Review cadence: quarterly, plus after any schema or
> hosting change.

## 1. Topology

| Datastore | Role | Hosting | Connection |
|-----------|------|---------|------------|
| Primary Postgres | Source of truth — users, workouts, plans, chat, connections (encrypted) | Railway managed Postgres (internal `*.railway.internal` host, private IPv6, no SSL) | `DATABASE_URL` |
| Vector DB (optional) | RAG `document_chunks` + embeddings | Separate pgvector instance (e.g. Neon) or the primary DB in single-DB mode | `VECTOR_DATABASE_URL` (falls back to `DATABASE_URL`) |

The vector DB is **derived data**: every chunk can be re-embedded from the
`coaching_materials` rows in the primary DB (`server/services/ragService.ts`).
It is therefore lower-criticality than the primary DB — losing it costs an
embedding re-run, not user data.

On boot the app self-heals structural state (`server/maintenance.ts`):
`runDrizzleMigrations()` applies pending migrations and `ensureVectorSchema()`
recreates the `document_chunks` table + HNSW index on the vector DB if missing.
A restore therefore only needs to recover **data**, not schema scaffolding.

## 2. Recovery objectives

| Target | Value | Rationale |
|--------|-------|-----------|
| RPO (max data loss) | **≤ 24h** from daily snapshots; **≤ 5 min** if PITR/WAL is enabled on the provider | Workout/chat data is valuable but not financial; tighten if the plan supports PITR |
| RTO (max downtime) | **≤ 1h** for primary DB restore | Single-service app; restore + redeploy is the long pole |
| Vector DB RTO | Best-effort | Rebuildable by re-embedding; not on the critical path |

Adjust these to match the Railway/Neon plan actually in use and record the
agreed numbers here.

## 3. Backup strategy

### Primary DB (Railway Postgres)
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

   The dump contains **encrypted** Strava/Garmin credentials (AES-256-GCM); it is
   only restorable with the matching `ENCRYPTION_KEY`. Store that key separately
   from the dumps so neither alone is sufficient.

### Vector DB
If hosted on Neon, rely on Neon's automated backups + PITR window. Otherwise it
is acceptable to skip backups and rebuild via re-embedding (§5.3).

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
3. **Point the app at the restored DB.** Update `DATABASE_URL` on the service.
   Keep `ENCRYPTION_KEY` (and `ENCRYPTION_KEY_V2` if mid-rotation) identical to
   the source, or every stored credential becomes undecryptable.
4. **Redeploy.** On boot, migrations + `ensureVectorSchema()` run automatically;
   the `/api/v1/health` probe must go green before traffic is routed.

## 5. Restore — vector DB

1. If a vector backup exists, restore it the same way as the primary DB.
2. **pgvector must exist before restore.** The app runs
   `CREATE EXTENSION IF NOT EXISTS vector` on boot, but a manual restore into a
   bare DB needs the extension first: `CREATE EXTENSION IF NOT EXISTS vector;`
   (requires pgvector ≥ 0.7.0 for the halfvec HNSW index).
3. **Rebuild instead of restore (fallback).** With the primary DB intact, drop
   `document_chunks` and re-embed every `coaching_materials` row via the
   re-embed path; `ensureVectorSchema()` recreates the table + index on boot.

## 6. Restore-drill cadence & verification

Run a **monthly** restore drill into a throwaway service (never into prod):

- [ ] Latest backup restores without error.
- [ ] `schema_migrations` / Drizzle journal is at the expected version.
- [ ] Row-count spot checks on `users`, `workout_logs`, `training_plans` are
      within expectations.
- [ ] A known user's Strava/Garmin credential **decrypts** with the production
      `ENCRYPTION_KEY` (proves key + ciphertext integrity).
- [ ] FK integrity holds (no orphan rows; cascade chains intact).
- [ ] App boots against the restored DB and `/api/v1/health` returns `ok`.
- [ ] Record the actual restore wall-clock time and compare against the RTO.

## 7. Related

- `server/db.ts` — primary pool + internal-host SSL handling.
- `server/vectorDb.ts` — vector pool / single-DB fallback.
- `server/maintenance.ts` — boot-time migrations + `ensureVectorSchema()`.
- `server/crypto.ts` — at-rest credential encryption + key rotation (`docs` and
  `.env.example` cover `ENCRYPTION_KEY` / `ENCRYPTION_KEY_V2`).
- `docs/database.md` — schema reference.
