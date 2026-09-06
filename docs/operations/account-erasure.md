# Account Erasure Runbook (GDPR Art. 17)

> Owner: on-call / platform. Review cadence: after any change to
> `server/services/accountErasureService.ts` or the `users` FK graph.

## 1. Why this needs a runbook

`DELETE /api/v1/account` is not atomic and cannot be made atomic: it spans
Clerk, the primary Postgres, the separate vector DB, Strava, and pg-boss. One
of those steps is a **point of no return**:

> **Step 2 deletes the Clerk identity.** After it, the athlete has no
> credentials left. They cannot sign in, so they cannot ask to be deleted
> again, and no amount of retrying from their side will finish the job.

If a later step fails — the DB is down, the transaction deadlocks, the process
is killed mid-request — the account row and every cascading child row survive,
with nobody able to trigger their removal. That is an open-ended Art. 17
breach that produces no error anyone will see.

The Clerk delete cannot simply be moved later: `ensureUserExists` re-provisions
the DB row on the next authenticated request, so deleting the DB row first
means the very next request silently undeletes the account.

## 2. The mechanism

`users.erasure_requested_at` is stamped **before** step 2 and is never cleared
— the only thing that removes it is the row itself being deleted. So:

| Row state | Meaning |
|-----------|---------|
| `erasure_requested_at IS NULL` | Live account. |
| Stamped, less than 15 min ago | An erasure is probably still in flight. |
| Stamped, more than 15 min ago | **Stranded.** The run died; the identity is most likely already gone. |

`runStrandedErasureSweep` (`server/cron.ts`, hourly at :35 UTC, advisory lock
`accountErasureSweep`) re-runs `eraseAccount` for every stranded row. Every
step is idempotent — a Clerk 404 counts as success, the vector purges are
id-scoped, and the DB delete reports `deleted: false` when the row is already
gone — so replaying a partially-completed erasure is safe.

The stamp is written only when it is currently `NULL`, so retries preserve the
original "stranded since" time rather than resetting it.

## 3. Alerting

The sweep is silent when it finds nothing. It logs at:

- `warn` — `"Account erasure sweep: finished N stranded erasure(s), M still failing"`.
  Any occurrence means at least one erasure had previously failed. A non-zero
  `finished` count is the system healing itself; investigate the original
  failure, but no user action is outstanding.
- `error` — `"Stranded account erasure failed again — account still holds user data"`,
  with `userId` and `strandedSinceMs`. **This is the page-worthy one.** An
  account is repeatedly failing to erase and still holds personal data.

Alert on the `error` line, or on a `failed` count that stays non-zero across
consecutive hourly runs.

## 4. Manual recovery

Only needed if the sweep itself cannot run (cron down, or the same step keeps
failing).

1. **Find stranded accounts:**

   ```sql
   SELECT id, erasure_requested_at, now() - erasure_requested_at AS stranded_for
   FROM users
   WHERE erasure_requested_at IS NOT NULL
   ORDER BY erasure_requested_at;
   ```

2. **Find out which step is failing.** Search the logs for the user id; the
   erasure logs each best-effort failure and the sweep logs the fatal one. The
   fail-loud steps are the two vector-DB purges (step 1) and the user-row
   transaction (step 5) — everything else is best-effort and cannot strand a
   run.

3. **Fix the underlying store, then let the sweep pick it up** on the next
   hourly pass. This is the preferred path — it runs the same code as the
   route, so nothing is missed.

4. **If the sweep cannot run**, invoke the service directly on a box with
   production env vars:

   ```ts
   import { eraseAccount } from "./server/services/accountErasureService";
   await eraseAccount("<user id>");
   ```

   Do **not** hand-write `DELETE FROM users`: it skips the vector DB (which
   the FK cascade cannot reach), the private custom-food purge, the rate-limit
   buckets and the queued-job purge, all of which retain personal data.

## 5. What survives erasure by design

- **Public custom foods** (`foods.is_public = true`): sharing was an explicit,
  disclosed opt-in, so other athletes' logs keep resolving. Ownership is
  set-null, so the row no longer identifies its creator.
- **Garmin upstream tokens**: no revocation API exists in the SDK. Our copies
  are destroyed by the step-5 cascade; the upstream tokens expire on their own.
  Athletes needing immediate upstream invalidation change their Garmin
  password — this is stated on the privacy page.
