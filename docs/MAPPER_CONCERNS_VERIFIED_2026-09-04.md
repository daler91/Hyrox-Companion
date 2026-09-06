# Mapper-Concern Verification — 2026-09-04

**What this is.** The 2026-08-31 analysis (`docs/CODEBASE_ANALYSIS_2026-08-31.md`)
put its 34 lens findings through adversarial verification but explicitly did
not do the same for the ~53 **mapper-level concerns** in its subsystem notes:
"found by reading with file:line evidence but not adversarially verified."
This document is that missing pass, run against `main` on 2026-09-04.

**Method.** Seven agents, one per subsystem cluster, each instructed to try to
**refute** its assigned concerns rather than confirm them, to read current code
by symbol (not by the stale line numbers), and — for anything framed as a
maintainability complaint — to report a defect only if it could name a concrete
input producing a wrong output. Several verdicts were established by executing
the real modules rather than by reading.

**Result: 44 still real, 6 refuted outright, 1 already fixed, 2 partially
refuted, 1 new defect found.** The audit's own severity ordering turned out to
be inverted in places: **every High below came from the unverified mapper
notes, and none was a lens finding.** Two of them were filed as style gripes.

---

## Highs

| #   | Concern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | **Combining workouts destroyed every exercise set.** `combineWorkouts` inserted the merged log then deleted the sources; `exercise_sets.workout_log_id` cascades and nothing re-parented them. Also dropped `accessory`, RPE, device metrics and the compliance block client-side, and marked completed plan days _skipped_. The code comment claimed it "deletes/re-creates" the sets — it never re-created.                                                                                                                                | **Fixed** — sets are re-parented in place before the delete, preserving ids, unit stamps, prescription snapshots and lock versions.                                                                                            |
| H2  | **Un-completing a plan day deleted every linked log.** Copied one back (`.limit(1)`), deleted all. No unique index on `workout_logs.plan_day_id`; the plan-day picker deliberately offers already-logged days; the timeline renders through a last-write-wins `Map` and hides plan-linked logs, so the doomed row was invisible first. No confirmation dialog. `completed → skipped` hit the same branch.                                                                                                                                    | **Fixed** — the newest log folds back, the rest are unlinked (`plan_day_id = NULL`) and survive as standalone entries.                                                                                                         |
| H3  | **`normalizeWorkoutTextUnits` corrupted prescriptions.** `80-90kg` → `80-198 lbs` (the dash parsed as a minus sign, so only the high bound converted); `1,000m` → `1,0 ft` (no thousands handling). Persisted onto every generated plan day via `planGenerationService`. Filed by the audit as a maintainability complaint.                                                                                                                                                                                                                  | **Fixed** — both range endpoints convert together, thousands separators parse as one number, ambiguous decimal commas are left untouched.                                                                                      |
| H4  | **Offline queue dropped half the queue silently.** `saveQueue`'s quota fallback evicted oldest-first with no notification, while the overflow path in the same file carefully fires one. `DroppedMutationInfo["reason"]` had no variant for it.                                                                                                                                                                                                                                                                                              | **Fixed** — new `storage_full` reason; every evicted entry is announced, including in the full-clear fallback.                                                                                                                 |
| H5  | **Production has never run a data-bearing migration.** Confirmed by `docs/operations/backup-restore.md`: push-managed schema, boot `migrate()` classifies "already exists" as benign and skips the chain, ledger empty. 13 migrations carry DML; only 3 were tracked. Most consequential: `0049` seeds all 39 rows of `exercise_load_tags`, whose only code path is a `SELECT`, and `calculateTrainingLoad` defaults to `[]` and degrades **silently** across AI coach context, nutrition daily load, race prediction and training overview. | **Not a code fix.** The ten untracked migrations are now enumerated in `docs/operations/pending-manual-steps.md` with per-migration consequences and verification queries. **Someone with production access must audit them.** |

## Fixed in this pass, below High

| Concern                                                                                                                                    | Severity | Note                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `exerciseBreakdown` map keys reached the **system instruction** unsanitized (athlete `focus` text when it matches no known exercise)       | Medium   | `sanitizeUserInput` was already applied to the same field 33 lines below. Fixed at both renderers.                              |
| Those renderers also iterated **uncapped** while siblings `.slice(0, 7)` — ~20 MB into one prompt was reachable                            | Medium   | New finding, discovered during verification. Capped at 20 entries. Was also the most likely trigger for the breaker item below. |
| `aiRationale` replayed into prompts unsanitized — and it is **client-settable**, a plain field on the apply request body, not model output | Medium   | One authenticated POST. Sanitized at the prompt boundary, matching the four fields beside it on the same line.                  |
| `AthleteNoteInput` wiped the textarea mid-typing on a prop change                                                                          | Medium   | The only one of five sibling free-text inputs missing the `lastExternal` guard.                                                 |
| Plan generation fanned out up to 12 (×2 queue workers = 24) concurrent reasoning calls on a bare `Promise.all`                             | Medium   | Now `pLimit(3)`, matching `AI_PARSE_CONCURRENCY` in the reparse path.                                                           |

## Fixed in the second pass (2026-09-05)

The eleven trivial/small Mediums from the first pass's "still open" list. Every
fix carries a regression test verified to fail against the pre-fix code.

| Concern                                                                                                     | Severity | Note                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Food-search queries logged in plaintext at info level                                                       | Medium   | All four search clients log `queryLength` only.                                                                                                             |
| Apply-transaction failures reported as "already applied or dismissed" (409)                                 | Medium   | A typed `ProposalNoLongerPendingError` marks the one lost-race case; any other fault out of the transaction now rethrows as the 500 it is.                    |
| DB statement timeouts classified as `AI_UPSTREAM_FAILURE`                                                   | Medium   | `isDatabaseError` (SQLSTATE code + pg severity, walking the cause chain) short-circuits the classifier; the message patterns are word-bounded.                |
| Unit-blind progressive-overload clamp                                                                       | Medium   | Weeks compare in kg via each set's own stamp; the ceiling is written back in the set's unit, floored so it never rounds above the ceiling.                    |
| Analytics staleness anchor stamped after generation                                                         | Medium   | `regenerateAndStore*` and the cron dispatch capture the anchor before generating and hand it to `persist*`.                                                  |
| `usePreferencesForm` discards unsaved edits on refetch                                                      | Medium   | A refetch re-syncs draft and baseline only while the form is clean.                                                                                          |
| `ExerciseTable` snapshots `defaultExpanded` at mount                                                        | Medium   | Rows arriving after mount are opened once; a row the athlete collapsed stays collapsed.                                                                       |
| `TOAST_LIMIT = 1` eats multi-PR celebrations                                                                | Medium   | One toast per batch ("2 new PRs", every record in the description).                                                                                          |
| `syncStructureStepMirror` outside the set transaction; delete path never syncs                              | Medium   | Add/update/delete each run the set write and the step mirror in one transaction; delete re-syncs the step from the lowest-ordered surviving sibling.          |
| Strava calorie enrichment with no overall deadline                                                          | Medium   | 30 s wall-clock budget across the pass; stops with `attempted`/`of` counts, remaining rows import without calories.                                           |
| Email tests excluded from typechecking with drifted fixtures                                                | Medium   | Both files are back in `tsconfig.test.json`; fixtures come from `createMockUser` / `createMockWeeklySummary` / `createMockMissedWorkout` in `test/factories`. |

## Fixed in the third pass (2026-09-06)

The three Mediums the second pass deferred because each needed a design
decision first. Regression tests as before.

| Concern                                                                       | Severity | Note                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useWorkoutDetail`'s whole-object rollbacks clobber concurrently-saved edits   | Medium   | Every field mutation snapshots and restores only the keys it writes, through one pair of helpers. `updateFocus` had always done this; it is the rule now.                                                                                    |
| `FieldInput` shows an unsaved number permanently after a failed save           | Medium   | The commit machine gains an "optimistic write observed" state. Before it, a stored value equal to the pre-edit one means the debounce hasn't fired; after it, the same value means a rollback — so the field stops showing a rejected number. |
| Clerk identity deleted before DB erasure, no way to recover a stranded account | Medium   | `users.erasure_requested_at` is stamped before the point of no return, and an hourly sweep re-runs the (idempotent) erasure for any row still carrying it. The steps moved into `accountErasureService` so route and sweep share one implementation. Runbook: `docs/operations/account-erasure.md`. |

## Fixed in the fourth pass (2026-09-06)

The Low list, cheapest-last. Two of the notes did not survive contact with the
code — recorded below rather than quietly fixed to match the note.

| Concern                                                            | Note                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI breaker counts non-retryable 4xx toward tripping                | `recordBreakerFailure` now takes the error and ignores caller-side rejections (400/404/422, by structured status first and message second). 401/403/429/5xx still count, as the note required — those make the provider unusable for everyone. |
| Streaming bypasses the breaker entirely                            | `streamText` asserts the breaker before starting and records the outcome. It still can't retry (a retry would re-emit text the caller already has), but it is no longer invisible in both directions.                                        |
| `isRetryableError`'s unanchored status matching                    | Found while fixing the above, same family as the `errors.ts` fix in the second pass: `includes("500")` also matches the `1500ms` in this module's own timeout message. Word-bounded.                                                          |
| `MODEL_PRICING` bills unknown model ids at 67-83x                  | Resolves the longest matching family prefix before falling back, so a version suffix (`gemini-2.5-flash-002`) is priced as its family. Longest-prefix is load-bearing: `-lite` must not be billed at the `flash` rate.                        |
| `purgeUserJobs` fails silently while erasure returns success       | **Partly refuted.** pg-boss v12 has no `archive` table (verified against the installed schema), so the purge does reach completed jobs — the existing comment was right. What was real: the failure was swallowed at `warn`, and this step runs after the erasure marker is deleted, so nothing retries it. Now returns a count and logs failures at `error` as a retention issue. |
| `server/garmin.ts` unbounded `includes("401")`                     | Now `looksLikeUnauthorized`, mirroring its properly-bounded `looksLike429` sibling: structured status first, word-bounded message second. It used to tell an athlete their credentials were rejected because an activity id contained `401`.  |
| Duplicate Atwater factors in three places                          | `mealFuelling.ts` and the nutrition page's utils now import `KCAL_PER_G` from `nutritionScaling.ts`, which derives it from the three scalar constants. The "single definition in the codebase" comment there is now true.                     |
| Mislabeled "Avg Reps / Session" tile                               | The tile renders `totalReps` (its own test id says so) with the average on the line below; relabelled "Total Reps".                                                                                                                          |
| Stale test counts in `docs/testing.md` and `README.md`             | The note's diagnosis was off — ripgrep matches these globs against the basename, so nothing is wrong with the dot. The exclusion is broken for a different reason: the smoke test is named exactly `smoke.test.ts`, so `!*.smoke.test.ts` matches nothing and leaves it in the unit count. The table now carries the command for each row, the corrected `!smoke.test.ts` glob, the real path (`server/routes/tests/smoke.test.ts` — the one the doc named does not exist) and dated figures. |
| `TECHNICAL_DEBT` #29 lists Cypress as blocking                     | Condition (iii) marked satisfied (repo is on Cypress ≥ 15.21.1); (i) TS 7.1 stable API and (ii) typescript-eslint TS 7 support still block, so the entry stays open.                                                                          |

## Refuted

Recorded so they are not re-raised.

| Concern                                                                 | Why it does not hold                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GDPR export leaks the raw `users` row                                   | Every column on `users` is the athlete's own data — no tokens, credentials or third-party ids exist on that table, and Art. 20 portability requires most of it. The other sections are scrubbed because they hold OAuth and push-encryption secrets; `users` has no equivalent. Latent only: an unfiltered `SELECT *` means a future secret column would enter silently. |
| Cron endpoint's `as string` header cast 500s on duplicate headers       | Verified empirically on Node 22: the parser joins duplicates to `"a, b"` for any `x-*` header, so the hash succeeds and the handler returns a clean 401. Unreachable.                                                                                                                                                                                                    |
| pg-boss `runBatch` retries successful jobs, burning duplicate AI spend  | All five `queue.work()` sites pass no options, so `batchSize` defaults to 1 and a failing batch fails exactly the job that failed. The code comment claiming pg-boss "retries only the failed ones" is wrong, and this becomes real the moment anyone sets `batchSize > 1`.                                                                                              |
| Divergent `mean()` empty-array behaviour across modules                 | Real in source (one returns `NaN`, two return `0`) but every call site is guarded by an earlier length check. `round1`/`clamp` do not diverge at all across their 8 and 7 copies.                                                                                                                                                                                        |
| Analytics tab grid emits `className="undefined"`                        | `tabCount` is arithmetically bounded to {5, 6, 7} and all three keys exist. Latent only if a third optional tab is added.                                                                                                                                                                                                                                                |
| Client `includes('401')` false positives                                | `isUnauthorizedError` has zero production importers. Every live status check is `startsWith`-anchored or conjunctive. **However** the same defect is live one directory over at `server/garmin.ts:337`, where its sibling `looksLike429` was deliberately word-bounded and the 401 check was not.                                                                        |
| `pendingWorkouts` UTC date-slice renders offline logs on tomorrow's row | The pattern is present and the ESLint rule genuinely does not cover it, but the `??` fallback is unreachable: every producer supplies a local-TZ `date`, and a cleared field yields `""`, which is not nullish.                                                                                                                                                          |
| `custom:<label>` reaching prompts (half of the sanitization concern)    | Already fixed at HEAD, and never fed `exerciseBreakdown` anyway.                                                                                                                                                                                                                                                                                                         |
| Streaming AI "hangs forever" with no stall timeout                      | No idle timeout exists, but a 5-minute SSE deadline with forced socket teardown bounds it.                                                                                                                                                                                                                                                                               |

## Still open

Verified real, not addressed in this pass. Roughly cheapest-first within each group.

**Medium.** None outstanding — the three that remained after the second pass
were fixed in the third (see above).

**Low (remaining).** Anthropic JSON path has no fence-stripping (latent:
non-default provider). FatSecret + Spoonacular: 928 LOC unreachable, with a
**fatal** boot refinement for an integration that does nothing. Unverified
sled-pull loads feeding predicted finish times behind a stale "verify against
the rulebook" marker. `reconcileToDaily` discards the clamp signal for protein
and fat. `sortOrder` MAX+1 race. Check constraints duplicating TS enums.
Hover-only `title` explanations on five cards, inaccessible to touch, keyboard
and screen readers. 74 auto-generated "⚡ Bolt Performance Optimization"
comments across 51 files, two of which now describe code that was extracted
away. `timeline-benchmark-check.ts` parses `console.table` box-drawing output by
column position and is wired into no workflow — wiring it as-is would likely
flake, since its thresholds are absolute dev-machine milliseconds.

**Fixed in the fourth pass, previously listed here:** AI circuit breaker counts non-retryable 4xx toward tripping (a blanket
"ignore 4xx" would be wrong — 401 _should_ trip it). Streaming bypasses the
breaker entirely. Anthropic JSON path has no fence-stripping (latent: non-default
provider). `MODEL_PRICING` bills unknown model ids at 67-83× the fast default,
warned once per process. FatSecret + Spoonacular: 928 LOC unreachable, with a
**fatal** boot refinement for an integration that does nothing. `purgeUserJobs`
couples GDPR erasure to pg-boss internals and fails silently while still
returning success. `server/garmin.ts:337`'s unbounded `includes("401")`.
Duplicate Atwater factors in three places with nothing to catch divergence.
Unverified sled-pull loads feeding predicted finish times behind a stale
"verify against the rulebook" marker. `reconcileToDaily` discards the clamp
signal for protein and fat — though `reconcile_clamped` has exactly one hit
repo-wide (its own definition), so carbs are equally silent. `sortOrder` MAX+1
race. Check constraints duplicating TS enums. Mislabeled "Avg Reps / Session"
tile rendering the total. Hover-only `title` explanations on five cards,
inaccessible to touch, keyboard and screen readers. 74 auto-generated "⚡ Bolt
Performance Optimization" comments across 51 files, two of which now describe
code that was extracted away. Stale test counts in `docs/testing.md` (claims 262) and `README.md` (claims 330) — the real unit-test figure was 426 when this pass ran, and it moves every time a test lands, which is the actual problem: `testing.md`'s own recipe is wrong (its `-g "!*.smoke.test.ts"` glob needs a literal dot and so excludes nothing, and it names a smoke-test path that does not exist), so anyone re-deriving the number gets a different wrong answer. `TECHNICAL_DEBT` #29 still
lists Cypress as blocking though 15.21.1 satisfies the condition.
`timeline-benchmark-check.ts` parses `console.table` box-drawing output by
column position and is wired into no workflow — note that wiring it as-is would
likely flake, since its thresholds are absolute dev-machine milliseconds.
