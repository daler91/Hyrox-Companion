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

## Fixed in the fifth pass (2026-09-07)

The rest of the Low list that is cheap and unambiguous. What is left after this
pass is either a delete/keep decision that is not mine to make, or a design
change (see **Still open**).

| Concern                                                            | Note                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic JSON path has no fence-stripping                         | The note was half right: `anthropicSystemInstruction` *does* honour `request.json` — it appends "Return only valid JSON. Do not wrap the JSON in Markdown fences." The gap is on the way back, where a model that fences anyway hands the caller unparseable text. `stripJsonCodeFence` now unwraps a reply that is *entirely* one fenced block, and leaves anything else untouched so prose containing a fence is not silently truncated. |
| `reconcileToDaily` discards the protein and fat clamp signals       | All three macros' return values are now OR-ed into one flag. Renamed `carbClamped` → `reconcileClamped`, since it never described only carbs and the old name is why the other two were dropped. A protein-or-fat-only clamp is reachable — the added test drives one.                                       |
| Hover-only `title` explanations on five fuelling surfaces           | One `ExplanationTooltip` (a real `<button>` with an `aria-label` carrying subject and explanation) replaces the bare `title` on `FuellingCorrelationCard`, `FuellingAroundSessionPanel`, `FuellingPlanPanel`, `DailyTotalsHeader` (both macro notes) and `WorkoutSummaryHeader`'s stat tiles. `title` is mouse-only: touch and keyboard users had no way to reach the explanation, and screen readers announce it inconsistently. Modelled on `MafCeilingChip`, which already got this right. |
| Two Bolt comments describing extracted-away code                    | Removed at the two `computeAdherencePct` call sites in `analyticsService.ts`, where the described loop no longer exists. The H10 rationale that shares the first site is real and stays. 74 → 72.                                              |

## Fixed in the sixth pass (2026-09-07)

What was left needed a decision rather than a patch. Two were put to the owner:
the dead branded-food clients are deleted; the remaining Bolt comments stay.

| Concern                                                            | Note                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FatSecret + Spoonacular: ~1,600 LOC unreachable, with a **fatal** boot refinement | Deleted, on the owner's call. `foodSearch.ts` wires USDA/OFF/Edamam and `barcode.ts` Edamam/OFF — neither client had a search caller, so the only reference was `refresh.ts` re-fetching rows whose `source` is `fatsecret`/`spoonacular`, which nothing could ever create. Gone with them: the two `refresh` cases (an unknown source already falls through to `default` and keeps serving its cached row, so a hypothetical legacy row degrades rather than breaks), the `FATSECRET_*`/`SPOONACULAR_*` env vars, the refinement that killed boot on a half-set FatSecret credential pair, the two dead provider columns on `MICRO_DEFS`, and the two dead members of `MappedFood["source"]`. Both values stay legal in `foods_source_check`: narrowing a CHECK is a migration that fails on any surviving row and buys nothing. |
| `sortOrder` MAX+1 race                                             | The MAX+1 was already folded into the INSERT as a correlated subquery, which is not enough — under READ COMMITTED it cannot see another transaction's uncommitted row, so two inserts racing on one container both land on N and the two sets end up with no defined order. `addExerciseSetNormalized` now row-locks the container first, exactly as `seedExerciseSetsFromPlanDay` already did against the same failure. The lock replaces the old un-locked ownership read rather than adding a query, and locks the plan day itself rather than the joined plan, so it doesn't serialize a whole plan. The owner-adapter machinery moved to `storage/exerciseSetOwners.ts` — it no longer touched `this`, and the file was over its line budget. |
| Check constraints duplicating TS enums                             | The five CHECKs that mirror a TS constant now render from it (`inValues`), so there is no second list to update: `status_check` ← `workoutStatusEnum`, `plan_days_skip_reason_check` ← `planDaySkipReasonEnum`, `foods_source_check` ← `FOOD_SOURCES`, and both `meal_type` CHECKs ← the one `MEAL_TYPES`. `sql.raw` is unavoidable for DDL text, so every value is checked against a bare-identifier pattern first. `drizzle-kit generate` reports **no schema changes**, so the switch implies no migration; `checkConstraints.test.ts` pins each rendered constraint to the deployed text, which is what now forces a migration when a constant changes. |
| `timeline-benchmark-check.ts` parses `console.table` by column position | The benchmark emits its rows as one JSON line; the checker reads that. The old reader sliced `│`-delimited cells counting from the right, so a renamed or reordered column, or a value long enough to wrap, produced NaN or the wrong field — and `parity` had to be compared against the STRING `"true"`. The shared format lives in its own module because the benchmark runs its whole workload at import time: importing it from the checker for a constant ran the benchmark twice. Still wired into no workflow, and the file now says why — the thresholds are absolute developer-machine milliseconds, so shared CI hardware would report noise as regressions. |
| Duplication introduced by the fifth pass                           | Found by the pre-push duplication check, not by the audit. `ExplanationTooltip` had reproduced `MafCeilingChip`'s Radix trigger boilerplate, and the two fuelling panels had two copies of the same guidance paragraph. The tooltip now takes trigger content (the chip passes its own; `subject` is optional, since the chip's text already names the number), and the paragraph is one `FuellingGuidanceNote`. |

## The three concerns this pass had missed (2026-09-07)

Writing the outcomes back into the 2026-08-31 analysis surfaced three of its
mapper concerns that were never carried into this document at all — neither
verified nor refuted. They are done now, to the same standard: refute first,
and report a defect only with a concrete input producing a wrong output.

| Concern                                                            | Verdict | Note                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveParsedWorkoutsBatch` claims "a single transaction" but runs delete and insert as two non-transactional statements | **Real, and worse than filed** | The claim is verbatim, in the Bolt comment directly above the function. The audit called it "safe only because the sole caller pre-filters" — the pre-filter does not make it safe, it only makes it hard to reach. The insert is one multi-row statement across the whole chunk, so one rejected row (a negative weight, a `set_number` of 0 — any CHECK the misparse trips) fails it for all five workouts; the delete had already committed, so those workouts were left with no sets and the function returned `failed`, having destroyed rows it could not put back. Reaching it needs the delete to have something to delete, and `batchReparseWorkouts` obliges: it snapshots "workouts with no sets" **once**, then spends minutes on AI parses working through chunks of five, so an athlete who opens one of those workouts mid-run and logs sets by hand has written exactly the rows the later delete removes. **Fixed** — delete and insert now share a transaction, which is what the two sibling functions twenty lines below already did. |
| The global handler sends every 4xx to Sentry unconditionally        | **Real**  | `server/index.ts` called `Sentry.captureException(err)` on every path, and `beforeSend` (`scrubSentryEvent`) only strips PII — no status filter, no `ignoreErrors`. So every zod rejection, unauthenticated request, stale-id 404 and idempotency 409 became an event: the API correctly refusing a request, reported as a fault, burying the 500s worth paging on. **Fixed** — `shouldReportToSentry` keeps 5xx and 429 (a single rate-limited request is noise; a sustained stream is a runaway client and is not visible anywhere else) and drops the rest. Reporting only: every status is still logged and still returned unchanged. The threshold was the owner's call. |
| Idempotency caching only intercepts `res.json`, latent for any future `res.send` route | **Refuted** | The premise is true and the conclusion is not. `idempotencyMiddleware` already registers `finish` and `close` listeners that release the claim when a response completes without passing through the patched `res.json`, and its own comment names the three cases — "an error sent via res.end, a streamed/redirect response, or a client abort". A test pins it. So a `res.send` route degrades to *not cached*, which is the safe direction, rather than pinning the claim or caching a wrong reply. The residual, narrower than filed: such a route would silently lose retry **dedupe** — a retried offline-queue mutation would re-execute instead of replaying — and nothing enforces that mutating routes reply via `res.json`. No current route is affected: `protectedMutationGuards` is applied to mutations only, the sole `res.send` route is a GET export behind `isAuthenticated` alone, and the `res.end` calls are SSE streams, where re-executing is the wanted behaviour anyway. |

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

One item, and it is not a code change.

**Unverified sled-pull loads.** `STATION_LOADS_KG` in `shared/raceConstants.ts`
marks every `sled_pull` value with ⚠️ and a header note to verify it against the
official rulebook; the other stations are confirmed. These are rulebook facts
that feed predicted finish times, so they need the rulebook, not a judgement
call — the marker stays until someone checks it against the current one. It is
at least honest: the uncertainty is visible at each value rather than implied.

Everything else this document verified as real has been addressed across the six
passes above, or is recorded under **Refuted**. The Highs and Mediums went in
passes one to three, the Lows in passes four to six.

Two were closed by a decision rather than a fix, both the owner's:

- **FatSecret + Spoonacular** — deleted rather than wired up (sixth pass above).
- **The remaining 72 "⚡ Bolt Performance Optimization" comments across 51
  files** — left in place. They are noise, but a comment-only edit touching 51
  files is review burden for no behaviour change. The two that actively
  described code extracted away are already gone (fifth pass).

And one thing the sixth pass improved without closing:
`timeline-benchmark-check.ts` now parses reliably but is still wired into no
workflow, because its thresholds are absolute developer-machine milliseconds.
Wiring it needs budgets measured relative to a baseline in the same run; the
script says so at the top.

**Removed from this list by the fourth pass (2026-09-06):** AI circuit breaker
counts non-retryable 4xx toward tripping (a blanket "ignore 4xx" would be wrong
— 401 _should_ trip it). Streaming bypasses the breaker entirely.
`MODEL_PRICING` bills unknown model ids at 67-83× the fast default, warned once
per process. `purgeUserJobs` couples GDPR erasure to pg-boss internals and fails
silently while still returning success. `server/garmin.ts:337`'s unbounded
`includes("401")`. Duplicate Atwater factors in three places with nothing to
catch divergence. Mislabeled "Avg Reps / Session" tile rendering the total.
Stale test counts in `docs/testing.md` (claimed 262) and `README.md` (claimed
330) — the real unit-test figure was 426 when that pass ran, and it moves every
time a test lands, which was the actual problem: `testing.md`'s own recipe was
wrong, so anyone re-deriving the number got a different wrong answer.
`TECHNICAL_DEBT` #29 listing Cypress as blocking though 15.21.1 satisfies that
condition.

**Removed from this list by the fifth pass (2026-09-07):** Anthropic JSON path
has no fence-stripping (latent: non-default provider). `reconcileToDaily`
discards the clamp signal for protein and fat — noted then as near-moot because
`reconcile_clamped` had one hit repo-wide (its own definition), which is exactly
why the two dropped signals had gone unnoticed. Hover-only `title` explanations
on five cards, inaccessible to touch, keyboard and screen readers. Two of the
Bolt comments describing code that was extracted away.

**Removed from this list by the sixth pass (2026-09-07):** FatSecret +
Spoonacular: 928 LOC unreachable, with a **fatal** boot refinement for an
integration that does nothing. `sortOrder` MAX+1 race. Check constraints
duplicating TS enums. `timeline-benchmark-check.ts` parsing `console.table`
box-drawing output by column position.

**Left open deliberately:** the 72 remaining Bolt comments (the owner's call),
and the unverified sled-pull loads, which need the rulebook rather than a code
change. See **Still open**.
