# Coach memory — the durable athlete card

**Status.** **Paths A and B shipped**; the §5 collisions are closed and the prompt-wiring
remainder (skip reasons, absences → plan generation, MAF context) has landed. **Path C — the
athlete-facts card itself (§2–§6) — is the open scope**, gated on the §7 measurement:
run `pnpm tsx script/coach-memory-usage.ts` against production before deciding. Register entry:
recommendation #8 in [`PRODUCT_OPPORTUNITIES.md`](PRODUCT_OPPORTUNITIES.md). **Read §0 before
costing this** — two load-bearing claims in that register entry are wrong, and they were mine.

**One-line pitch.** Tell the coach the things that are true every week — bad left knee, no sled
at my gym, shift work on Tuesdays — once, and have it remember.

---

## 0. Two corrections to the register, and what they cost

**"The insertion point already exists and is already shared" is false.** The register says
anything added to `TrainingContext` and rendered by a `coachingContext.ts` builder "reaches
chat, suggestions and auto-coach at once through `aiContextService.ts`". There are in fact
**three prompt assemblers**, and they share almost nothing:

| Assembler                                                                | Reaches                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `buildSystemPrompt` (`server/prompts.ts:526`)                            | chat, chat/stream, coach insights                                    |
| `buildPromptDataSections` (`server/gemini/suggestionService.ts:227`)     | auto-coach suggestions, review notes, conversational plan adjustment |
| `buildGenerationPrompt` (`server/services/planGenerationService.ts:102`) | AI plan generation — never sees `TrainingContext` at all             |

Only two files import from `coachingContext.ts`: `server/prompts.ts`, and
`suggestionService.ts` — which takes `relativeDayLabel`, a date-label helper, and nothing else.
A builder added there reaches **chat and coach insights only**. This is a wiring job across
four render sites, not a one-line insertion.

**"Uploading a PDF is the wrong shape for six sentences" is true as principle, false as a
description of this implementation.** Settings → Coaching Knowledge → _Add Training Principles_
is already a free title+body textarea writing `coaching_materials` with `type: 'principles'`
(`client/src/components/settings/CoachingSection.tsx`,
`client/src/components/settings/coaching/useCoachingUpload.ts`). Retrieval has **no similarity
threshold**: `searchChunksByEmbedding` (`server/storage/coaching.ts`) orders by cosine distance
and takes `TOP_K = 6` (`server/services/ragService.ts`). At `RAG_CHUNK_SIZE=600`
(`server/env.ts`), "bad left knee, no sled at my gym, shift work Tuesdays" is **one chunk** — so
for any athlete whose whole corpus is ≤6 chunks, those facts are already in every chat and
suggestion prompt unconditionally. With no embeddings at all, the legacy fallback dumps every
material verbatim up to 8000 chars (`server/prompts/materialsBuilder.ts`).

**What actually remains true.** RAG reaches chat and suggestions but **not plan generation**,
its inclusion is incidental rather than guaranteed (it degrades the moment the corpus exceeds
six chunks), and nothing about it is structured — you cannot ask "which equipment does this
athlete lack" or expire a fact. Those are real gaps. They are smaller and differently shaped
than the register implied.

---

## 1. The sequencing question — needs a decision before any code

Three materially different scopes. They are not refinements of each other.

**Path A — persist the string the product already collects (S).** Plan generation asks for
"Injuries or Limitations" in a 500-char textarea
(`client/src/components/plans/generate-plan/GeneratePlanDetailsStep.tsx`), interpolates it at
`planGenerationService.ts:127-129`, and **persists it nowhere** — no `injuries` column exists in
`shared/schema/tables.ts`. One column plus a Settings field tests the entire hypothesis: do
athletes state durable constraints when asked, and does remembering them help? It also fixes a
real defect — that interpolation is the only free-text prompt injection in the repo with no
`sanitizeUserInput` call.

**Path B — the dated constraint pipeline (M).** The bottleneck is not that there is nowhere to
say it. There are already **three** structured captures and none reaches any prompt:
`timeline_annotations` (dated injury/illness/travel/rest, full CRUD, self-serve form),
`plan_days.skip_reason` (CHECK-constrained chips, shipped), and
`users.mafInjuryIllnessMedication`. Wiring the dated ones into the three assemblers _is_
register #2, is scored **H+D** against #8's **D**, and delivers most of coach memory's value
with no new capture surface.

**Path C — the full athlete card (M–L).** New `athlete_facts` table, Settings CRUD, four render
sites, review dates, safety-corpus split. §2 onward specs this.

**Path A is now built.** `users.training_constraints` (migration `0086`), written on every
plan generation from the wizard's textarea, prefilled back into it, editable and clearable in
Settings → Injuries & Limitations, and the interpolation is sanitised. Two semantics worth
knowing:

- **Presence is authoritative.** The client now always sends `injuries`, even empty, and an
  empty string writes `null`. Omitting the field when blank would make "I cleared the box"
  indistinguishable from "this client never sends one", so a resolved injury could never be
  forgotten — the exact `maf_injury_illness_medication` failure in §2.
- **The remembered value is a prefill, not a fallback.** The server never substitutes the
  stored constraints into a generation request that omitted them. Reviving text the athlete
  deleted is the staleness bug, not a convenience.

What Path A deliberately does **not** do: reach chat, auto-coach, or any prompt other than plan
generation. That is Paths B and C, and it is the honest boundary — this is one durable string
in the one prompt that already asked for it.

**Recommendation for what remains: B, then C.** Path C's own centre of gravity is the write path — an
empty facts table makes the whole feature worthless — and A is the cheapest honest measurement
of whether that table will ever be non-empty. B outranks C in the register's own scoring. If C
ships first and nobody writes a fact, we will have built a Settings list nobody visits to feed
prompts that already contain the same sentences via RAG.

**If C is wanted regardless, §2 onward is buildable as written.** The rest of this document
specs C, because the analysis is done and it is the version with the traps in it.

---

## 2. The decision inside Path C: does a fact expire?

The register sketch says no — an `active` boolean edited in Settings. **That mechanism is
already shipped here, for this exact category of data, and it has already failed.**

`users.mafInjuryIllnessMedication` is an athlete-stated durable health fact, captured once at
onboarding (`client/src/components/onboarding/GoalStep.tsx`,
`client/src/hooks/useOnboardingWizard.ts`). It permanently subtracts 10 bpm from the athlete's
MAF ceiling (`shared/maf.ts`, recomputed server-side on every preference save in
`server/storage/users.ts`). And there is no way to turn it off: `usePreferencesForm.tsx` _reads_
the flag and feeds it back into `calculateMafHr`, but the save payload does not contain the
field. **A healed knee still caps this app's training zones, with no in-product way to un-cap
it.** That is the `active`-boolean design, in production, unrepaired.

**Decision: every row carries `review_on`, NOT NULL, defaulted 90 days out.** A row past its
review date still renders — silently dropping a fact the athlete typed is worse than keeping a
stale one — but renders flagged (`(unconfirmed since …)`), sorts to the top of the Settings
list, and gets a two-tap _Still true? / Retire_. One column, one suffix, one sort order, two
buttons: the cheapest thing that makes the card self-correcting instead of self-poisoning.

**Dated is the native shape.** Register #2's input is `timeline_annotations`, which is nothing
but an inclusive dated range. A v1 whose entry type has no date field cannot absorb #2 without
rewriting the renderer — the one thing this decision exists to freeze.

---

## 3. Data model

`athlete_facts`, shaped on `timeline_annotations` — the repo's only user-authored,
CHECK-constrained, indexed CRUD table.

```
id          varchar(255) PK default gen_random_uuid()
user_id     varchar(255) NOT NULL references users.id onDelete cascade
fact        text         NOT NULL          -- CHECK length 1..140
dedupe_key  varchar(160) NOT NULL          -- server-derived: lower(collapse_ws(trim(fact)))
category    varchar(24)  NOT NULL          -- constraint | equipment | schedule | preference | other
source      varchar(24)  NOT NULL default 'athlete'   -- athlete | plan_generation | onboarding
active      boolean      NOT NULL default true
review_on   date         NOT NULL
created_at / updated_at  timestamptz
uniqueIndex (user_id, dedupe_key)
index       (user_id, active)
```

- **140 chars, not 500.** One fact per row is what makes per-fact delete usable and the render
  cap meaningful. Bounded twice — zod `.max(140)` _and_ the DB CHECK — matching house style.
- **`dedupe_key` makes the seed re-runnable.** Regenerating a plan with the same injuries text
  must not accumulate duplicates. Derived server-side, never trusted from input.
- **Row cap 20 active per user**, enforced on write with a 409, not at render — a render-side
  cap silently discards facts the athlete typed.
- **No status enum, no `superseded_by`, no proposal table.** v1 has zero AI writes, so a state
  machine would have two reachable states. `plan_adjustment_proposals` cannot be reused
  regardless: its `plan_id` is NOT NULL with an FK to `training_plans`, and its storage keeps
  an at-most-one-pending-per-user invariant that is exactly wrong for N facts.

`tables.cascade.test.ts` sweeps every exported table automatically, so the cascade obligation is
enforced with no registration; bump its guard-the-guard floor. Account deletion is then correct
for free — `server/routes/account.ts` is a single cascade call.

---

## 4. Injection — one data site, four render sites

**Data side, one site.** `buildTrainingContext` (`server/services/ai/index.ts:224`) is the only
build site, and has exactly three non-test callers: `aiContextService.ts` (→ chat, chat/stream,
timeline suggestions, coach insights) and **two direct calls in `coachService`** that bypass
`buildAIContext` entirely — `triggerAutoCoach` and `regenerateCoachNoteForPlanDay`. Injecting in
`aiContextService` instead would miss auto-coach, the consumer that silently rewrites the
athlete's upcoming plan. Add the read as a seventh entry in the existing `Promise.all`, never a
serial await: this is the heaviest read in the app and it is uncached.

**Type: top level on `TrainingContext`, not inside `coachingInsights`.** Two reasons.
`buildSystemPrompt` early-returns when `totalWorkouts === 0`, and that branch never calls
`formatCoachingAnalysis` — so an athlete who fills the card at onboarding and opens chat, the
highest-value moment this feature has, would see nothing. And `coachingInsights` is
hand-flattened into the persisted `plan_days.ai_inputs_used` audit; athlete free text should not
land there by accident.

**Render side, four sites:**

1. `server/prompts.ts` — the **zero-workout branch**, for the day-one athlete.
2. `server/prompts.ts` — main branch, inside the training-data envelope → chat, chat/stream,
   coach insights.
3. `server/gemini/suggestionService.ts` — into the `header` array → auto-coach suggestions,
   review notes, conversational plan adjustment (which reuses the chat turn's context and needs
   no separate wiring).
4. `server/services/planGenerationService.ts` — **replacing** the raw `Injuries/Limitations`
   line. Thread it exactly as the existing optional `startLoadPosture` param is threaded.

**Site 4 is the one to protect if the PR must shrink, not the one to cut.** Equipment and
schedule facts bind hardest at plan generation: cutting it means the generator programs sled
pushes for a gym with no sled — the exact failure the feature exists to prevent.

**The drift guard is a deliverable.** `mafHr` and `mafTrend` are `TrainingContext` fields
rendered by _neither_ prompt renderer — a grep across `server/prompts.ts` and `server/prompts/`
returns nothing. Adding a field to the type is not the same as it reaching the model. Ship a
co-located `server/prompts/athleteCard.test.ts` asserting the marker and the fact text appear in
the output of **both** `buildSystemPrompt` (including its zero-workout branch) and
`buildPromptDataSections`.

---

## 5. The two collisions that would otherwise ship broken

**5.1 The prompt will contradict itself.** `computeExerciseGaps` derives station gaps purely
from logged sets, with no equipment model, and `formatStationGaps` renders
`EXERCISE GAPS: sled_push (NEVER TRAINED — CRITICAL)` into the _same prompt_ that says "no sled
at my gym" — every week, forever. Two options: suppress the matching station in
`computeExerciseGaps` when an equipment fact covers it (correct, more work), or have the card's
header instruct the model to reconcile explicitly and program the substitute (cheap, and the
athlete still sees the contradiction if the note is echoed). **Do at least the header; prefer
the suppression.**

**5.2 The safety layer breaks in both directions.** `analyzeSafetySignals` returns two signals
from one text blob, with opposite tolerances for durability:

- `hrMedicationDetected` **appends** a disclaimer — idempotent, safe to make permanent.
- `redFlagDetected` **replaces every suggestion's text** with an escalation message. A fact has
  no end date, so one durable fact mentioning past chest pain would brick auto-coach forever.

**Decision: split the corpus.** Facts feed the medication stream only; the red-flag scan stays
on dated workout text. Leaving facts out of both is also wrong — a permanent written statement
of a heart medication sitting in every prompt while the deterministic disclaimer never fires
makes the app look like it was told and ignored it.

---

## 6. Delivery

| PR  | Contents                                                                                                              | Size |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `athlete_facts` table + migration + storage + CRUD routes + zod, no prompt wiring                                     | S–M  |
| 2   | `buildTrainingContext` read, `TrainingContext` field, builder, render sites 1–3, drift-guard test                     | M    |
| 3   | Render site 4 (plan generation) + sanitise the existing raw `injuries` interpolation + seed a fact from that textarea | S–M  |
| 4   | Settings CRUD list, review-date flagging, _Still true? / Retire_                                                      | M    |
| 5   | Safety-corpus split (§5.2) and exercise-gap suppression (§5.1)                                                        | M    |

Routes take **no** `aiConsent` / `aiBudget` flags: they call no provider, and the athlete must
be able to record "bad left knee" with the AI coach off, exactly as annotations allow today.
Consent is enforced where facts are _read_ — every render path already sits behind either
`aiConsentCheck` or an inline `aiCoachEnabled` check.

---

## 7. What could make this fail

- **Nobody writes the first fact.** Every capture that succeeds in this repo is attached to a
  moment: skip chips fire on the skip action, the athlete note is attached to the workout being
  logged, the injuries box sits inside plan generation. A Settings list has no moment. This is
  the strongest argument for Path A, whose capture point already exists.
- **The audience is small.** `aiCoachEnabled` defaults **false** and is presented in Settings as
  "Auto-Adjust Workouts". A feature whose entire value is invisible to opted-out users needs
  that switch understood before it needs more memory.
- **Facts reach the prose, not the machinery.** The load governor, `decideTrainingState` and the
  gap computation all run on structured data. A sentence cannot suppress a computed signal —
  see §5.1.
- **Demand is unmeasured.** Nothing in this tree says how many athletes have a `principles`
  material or send a non-empty `injuries` string. If both are near zero, the card will be too;
  if `principles` usage is meaningful, the real gap is retrieval _determinism_ — pin
  `type='principles'` chunks ahead of the topK search — which is about a day and no schema
  change.

---

## 8. Considered and not recommended

- **Reusing `plan_adjustment_proposals` for coach-inferred facts.** Plan-shaped end to end, and
  its one-pending-per-user invariant is wrong for N facts. v1 has no AI writes anyway.
- **Putting facts in `coachingInsights`.** Cheapest shared renderer, but misses the
  zero-workout chat branch and pollutes the persisted audit blob (§4).
- **A 500-char blob instead of N rows.** Matches the existing `injuries` field, but makes
  per-fact delete, per-fact review dates and the render cap impossible. Path A deliberately
  accepts the blob as a _measurement_, not as the destination.
