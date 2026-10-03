# AI Coach Chat Review — 2026-10-01

**Scope:** the conversational coach end to end. That covers the main Coach panel
(`client/src/components/CoachPanel.tsx`, `client/src/components/coach/`), the workout-detail chat
(`client/src/components/workout-detail/EmbeddedWorkoutCoachChat.tsx`), the shared hook
(`client/src/hooks/useChatSession.ts`), the chat routes (`server/routes/ai.ts`), prompt assembly
(`server/prompts.ts`, `server/prompts/`), context and retrieval (`server/services/aiContextService.ts`,
`server/services/ai/`, `server/services/ragRetrieval.ts`, `server/services/ragService.ts`), and
chat-driven plan editing (`server/services/chatIntentService.ts`,
`server/services/planAdjustmentService.ts`, `client/src/hooks/usePlanProposal.ts`).

**Method:** the code was read end to end. Two behaviours were checked by running verbatim copies of
the production logic in Node: the plan-edit keyword gate (D1, I9) and the Coach panel's message sort
(D3). Nothing was run against a live model or in the running app, so the latency and model-behaviour
claims are reasoned from the code, not measured. No application code was changed.

**Headline:** the plumbing is unusually solid: backpressure-aware SSE, abort propagation to the
provider, chunk-boundary output validation, sanitised prompt inputs, and fingerprinted proposal
staleness. The gaps are in the conversation itself:

1. **"Yes please" goes nowhere.** Confirming a change the coach just offered never reaches plan
   editing, and nothing in the chat prompt stops the coach from replying as if it had made the change.
2. **The chat has no safety net of its own.** Red-flag symptom detection runs on workout text for the
   auto-coach and for plan edits. It never runs on what the athlete types into chat.
3. **The coach often can't see what it's being asked about.** The workout chat doesn't tell the
   server which workout is open, and the chat prompt carries less per-session data than the
   auto-coach prompt.
4. **The browser owns the conversation.** History is uploaded by the client on every turn and saved
   by separate calls. As a result replies get lost, failed sends leave orphan turns, and the two chat
   surfaces drift apart.

---

## Remediation status (updated 2026-10-02)

Wave 1 is fixed (daler91/Hyrox-Companion#2085). Wave 2's first batch (D1(a), D5, I14, I15, I16) and
second batch (I1, I2, I3, I7) are fixed (daler91/Hyrox-Companion#2086), and its last two items, I6
and I19, on `claude/amazing-rubin-zz0w63`. Wave 3 is done on the same branch: I12, I4, I5 (the rolling summary, and chat-proposed athlete facts on top of coach-memory Path C, built on the same branch), I8 behind a flag, I22 and I23. The
rest of this document describes the code as it was reviewed, before these fixes. Checks run on the final code: typecheck in all three
configurations, ESLint on the whole repo (no errors; the only warnings in touched files, the lengths
of `server/routes/__tests__/ai.test.ts` and `shared/schema/tables.ts`, predate this work), the full
unit suite with coverage thresholds (6,537 tests), the storage integration suites against Postgres 16
with pgvector (71 tests), all 115 migrations applied to a fresh database and re-run as a no-op, and
`pnpm build` followed by `pnpm check:bundle`. Not run: Cypress (the binary download is blocked in
this environment) or any live model, so neither the scenario evals (I22) nor the tools path (I8)
has met a real one. The running app was driven, without a model, for wave 2's second batch and for
wave 3's UI (see below).

| ID      | Fix                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1(b)   | `BASE_SYSTEM_PROMPT` gains a PLAN CHANGES rule: a prose reply cannot change the plan and must never claim to, and the coach tells the athlete to ask directly ("Move my long run to Saturday") instead of offering to do it. Earlier proposal summaries in the history are named as the exception.                                                                            |
| D2      | `analyzeChatSafety` scans the athlete's message and previous turn with the existing patterns. A match sends a `safetyNotice` event before any text (the escalation as `urgent`, the medication disclaimer as `caution`), shown above the reply; the prompt gets matching guidance last; a red flag skips plan editing. `BASE_SYSTEM_PROMPT` gains standing MEDICAL SAFETY rules. |
| D3      | Every locally built message goes through `createLocalMessage` (`client/src/lib/chatMessage.ts`), which stamps `createdAtMs`; the field is now required, so a missing stamp is a type error.                                                                                                                                                                                  |
| D4      | `describeChatFailure` names the daily limit, rate limit, refused requests (with the server's own message), the server's stream endings (with its reason, now carried by `SSEStreamError`) and the two known 503s. The athlete's turn is saved once the server accepts the request. A failed reply keeps any text, carries a UI-only note and offers Try again when retryable, and stays out of later history. The chat input counts characters near the limit with the shared `CharacterCount` and blocks sending over it rather than truncating. A one-time toast follows `X-AI-Budget-Warning`. |
| D6      | Chat recent workouts carry RPE and duration; upcoming sessions carry the auto-coach's last review, modification and fatigue reduction through the shared `server/prompts/priorAiContext.ts`; max weight and distance are labelled in the athlete's units in both prompts; a Units line; "n/a" instead of a 0/0 "0%" completion rate in both prompts; the upcoming list is no longer called "next 7 days". |
| I9      | The stream route starts the plan-edit classifier alongside `buildAIContext`.                                                                                                                                                                                                                                                                                               |
| I10     | Chat replies use `resolveChatReasoningEffort()`: the lower of `AI_TEXT_REASONING_EFFORT` and `medium`, or the new `AI_CHAT_REASONING_EFFORT` when set. Coach insights keeps the global effort. The classifier passes `reasoningEffort: "none"`.                                                                                                                           |
| I17     | Chat replies render GFM via `remark-gfm` 4.0.1; wide tables scroll horizontally; `rehype-sanitize` still runs after it.                                                                                                                                                                                                                                                      |

**Behaviour changes worth knowing:**

- Chat replies think at `medium` instead of `high` by default. Set `AI_CHAT_REASONING_EFFORT=high` to
  restore the old behaviour.
- A message the server refuses is no longer saved to history. Neither is one the athlete stops before
  the server accepted it (after acceptance, a stopped partial reply is still kept, as before).
- The chat system prompt is somewhat longer: the PLAN CHANGES and MEDICAL SAFETY paragraphs, the
  Units line, RPE and duration per recent session, and prior-AI context per upcoming session.

**Wave 2, first batch:**

| ID      | Fix |
| ------- | --- |
| D1(a)   | `mayRequestPlanEdit` lets a short confirmation ("yes please", "go ahead") through the gate when the coach's last turn offered a change: one sentence with an offer phrase and an edit verb. The classifier then sees that offer, and `PLAN_ADJUSTMENT_PROMPT` says a confirmation asks for the change offered in the conversation it already receives. |
| D5      | Both chat routes accept `focusPlanDayId` and `focusWorkoutLogId`. `loadFocusedWorkout` reads them through the ownership-checked getters (failing open), and `formatFocusedWorkout` adds a FOCUSED WORKOUT block at the end of the training data. It shows the prescription beside the logged sets, duration, RPE, distance, heart rate and pace, plus the athlete note, adherence, session grade and the coach's notes. The non-streaming fallback sends the ids too. |
| I14     | `chatRetrievalQuery` retrieves nothing for a message that is only thanks or emoji, and semantic results further than `RAG_MAX_COSINE_DISTANCE` (default 0.6, deliberately loose) are dropped. Pinned principles always stay. The search log records the best distance and the kept count, to tune the cut-off against. |
| I15     | A short or pronoun-led follow-up searches with the previous athlete turn in front of it. |
| I16     | Each excerpt opens with its material's title, and the prompt asks the coach to name it. `ragInfo.sources` lists the titles, which survive production's `sanitizeRagInfo`, and the reply's chip reads "From your coaching notes" and expands to them. |

Behaviour changes: "thanks!" no longer spends an embedding call; a far-off excerpt can now be left
out where it used to fill a slot; the classifier runs for "yes please" after an offer.

**Wave 2, second batch:**

| ID      | Fix |
| ------- | --- |
| I1      | Each send carries `userMessageId` and `assistantMessageId` (client UUIDs), and the chat routes save both turns under them. The athlete's turn is saved once the request is accepted; the reply is saved when the stream ends, whether finished, cut off or a proposal, so a reply that finishes after the tab closes is kept. A retry reuses its message id, so the turn is saved once, and names the failed reply, which the server deletes. The coach's history is read from the database (`server/services/chatConversation.ts`); the client sends none and saves nothing. A request without the ids keeps the old path, so a tab open across the deploy saves nothing twice. |
| I2      | A break of 12 hours starts a new session. Its first message writes a short handover note of the earlier conversation (fast model, carrying the previous note forward, falling back to the athlete's last words), saved as a `summary` row; the coach reads it as an EARLIER CONVERSATION block instead of the old turns. Within a session, a pause of an hour or more is noted ahead of the next athlete turn ("5 hours later"). The chat shows day separators, and a "New conversation" divider whose note the athlete can open. |
| I3      | `chat_messages` gains `kind` (`text`, `proposal`, `summary`, CHECK-constrained), `proposal_id` (ON DELETE SET NULL), `safety_notice`, `rag_info` (titles, never excerpts) and the focus workout ids (migration 0111). A reload shows the safety notice and the coaching-notes chip again. `GET /chat/history` returns each proposal reply with its proposal and current status, and the card renders at that turn: actionable while pending, listing its changes once applied, folded away once dismissed, replaced or out of date. `GET /plan-proposals/:id` keeps a card's status live. |
| I7      | The coach's history notes what became of each proposal, ahead of the first athlete turn after it was decided: applied, dismissed, replaced, out of date, or still waiting. `BASE_SYSTEM_PROMPT` says only an applied proposal changed the plan. The Coach panel's apply confirmations, which were saved but never read, now reach the coach too. |

Checked beyond the unit suite:

- **Migration chain:** on a local Postgres 16 with pgvector, all 112 migrations apply to a fresh database and re-run as a no-op, and `\d chat_messages` shows the new columns, CHECK and FK.
- **Storage SQL:** a new integration suite (`chatMessages.integration.test.ts`) runs the save-once, owner-only delete, metadata, CHECK and ON DELETE SET NULL paths against that database.
- **The built app:** run against it with seeded history and driven in Chromium. It showed:
  - day separators, the applied, dismissed and pending cards in place, the persisted safety notice and the session note, at desktop and phone width;
  - Dismiss turning the inline card to "Dismissed" in place;
  - a failed send retried under the same `userMessageId` with `replaceAssistantId` and saved once;
  - after the chat was aged by a day, the fallback handover note saved ahead of the new session's first turn.

Behaviour changes:

- **The coach forgets raw turns at a session break.** After a 12-hour break it sees a few bullet points of the earlier conversation instead of up to 20 raw turns.
- **One more AI call per break.** The first message after a break makes one extra fast-model call, billed as `chat_summary`. It runs alongside the context build.
- **More of the conversation is saved.** A reply cut off by a dropped connection or a stream error is now saved as far as it got (only a Stop was before), and so is a reply that finishes after the tab closes.
- **The client sends no history.** The server reads the last 60 rows, as before trimmed to 20 turns and 30,000 characters, but only from the current session.

**Wave 2, last items, and wave 3:**

| ID      | Fix |
| ------- | --- |
| I6      | A proposal holds at most one change per day, and a card with more than one change has an Include toggle on each; `POST /plan-proposals/:id/apply` takes the pick (`planDayIds`) and writes only those changes. The apply records what each day's write replaced and wrote (`plan_adjustment_proposals.apply_undo`, migration 0112): the fields, the coach note, and, where it replaced or cleared the exercise table, the old rows whole. `POST /plan-proposals/:id/undo` puts them back for a week, but only what still reads what the apply wrote; an athlete's later edit, a newer coach note, a changed table or a day no longer planned stays, and the reply names those days. The proposal becomes `reverted`. The card shows "Applied — 2 of 4 changes" and offers Undo, including on an auto-applied proposal, and the coach's history names a partial apply's days and notes an undo. |
| I19     | `GET /api/v1/chat/welcome` builds the Coach panel's opening line and chips from the athlete's training, with no model call: their first name, a race in the next three weeks, today's session (or the one just done, or the next one), a load spike or hard sessions, new bests, and a missed session still undecided. Chips carry the message they send ("Pacing for today's Intervals" sends "How should I pace today's Intervals?"), filled to four with standing ones. The fixed text and chips stay as the fallback. |
| I4      | Each workout has its own thread. The workout-detail chat loads and sends only the rows saved with that workout's plan day or log (either id, so a planned day's thread carries on once logged), and the Coach panel only the rows with neither; `GET /chat/history` takes `focusPlanDayId` and `focusWorkoutLogId`. A session's handover note is saved into the thread it summarises, and the workout chat's header names the session and its day. |
| I5      | A long session keeps its start: the coach reads up to 30 turns in full, and past that all but the last 20 are folded into a rolling note (fast model, carrying the previous note forward, falling back to the athlete's last words), saved as a hidden `rolling` row (migration 0113) just after the last turn it covers and refreshed about every ten turns. The coach reads it as an EARLIER IN THIS CONVERSATION block, and the next session's handover is written from it. Chat-proposed facts sit on coach-memory Path C, the athlete card (migration 0115), built on the same branch. When the athlete's message may state something lasting (a keyword gate), the fast model reads it alongside the reply, on both paths. A fact the card doesn't hold is offered under the reply ("Save to your athlete card?": Save to card / Not now), saved on the reply row (`chat_messages.fact_proposal`, migration 0116) and answered through `POST /api/v1/chat/messages/:id/fact`. Nothing reaches the card until the athlete saves it, and nothing is offered after a red-flag symptom. |
| I8      | Behind `AI_CHAT_TOOLS` (default off), the streaming chat gives the reasoning model tools (`server/services/chatTools.ts`): `get_workouts` (logged and planned, up to 92 days), `get_exercise_history` (by name or custom label, up to 24 months), `get_personal_records` and `search_coaching_materials`, each bound to the requesting athlete, validated, capped and escaped, and `propose_plan_changes`. Read-tool results go back for up to three rounds, streamed throughout, then the model is asked for text. A `propose_plan_changes` call skips the keyword gate and classifier entirely: the proposal is drafted from the athlete's message and the coach's summary of the change, and follows what the coach already said. All three provider adapters stream tool calls, and Gemini's turns go back with their thought signatures. The prompt's PLAN CHANGES rule says to call the tool, and a TOOLS section says to look things up rather than guess. An auto-apply that throws now leaves the drafted card in the reply, on either path, instead of falling back to prose. |
| I22     | `test/evals/` holds 12 golden chat scenarios (19 runs across the two modes), graded by an LLM judge (the reasoning model at low effort) against each scenario's criteria: red-flag escalation, the governor's danger zone and the race-week taper in chat, never claiming an unapplied change (a direct request, "yes please" after an offer, a dismissed proposal), imperial units, the focused workout, and refusing to reveal the prompt. Each runs in `classic` mode, the prompt as shipped, and/or `tools` mode, the `AI_CHAT_TOOLS` path with canned lookups, where it also checks which tools were called. A criterion the judge skips, a non-JSON verdict, or a reply the output validator refuses fails. `pnpm eval:chat` runs them against the configured provider; CI checks without a model that each scenario's situation reaches the system prompt. |
| I23     | Each streamed reply logs one `[chat] turn` line with no message text: time to first text, context time, total time, mode, outcome, whether it was a regenerate, the plan-edit gate and the classifier's verdict and confidence, the tools called, what proposal drafting returned and the proposal id, reply length, retrieval and safety notice. A coach reply the server saved gets Helpful and Not helpful buttons, stored in `chat_messages.feedback` (migration 0114) through `PATCH /api/v1/chat/messages/:id`. `script/chat-quality-report.ts` prints the proposal apply, partial-apply, undo, dismiss, stale and replaced rates and the reply ratings for the last N days. |
| I12     | The chat reads its training context through a per-athlete cache (`server/services/trainingContextCache.ts`, five minutes, concurrent builds shared, the athlete-local date in the key). It is dropped after any successful write request by the athlete outside the chat, after any background job for them (the auto-coach, syncs, plan generation), and when a proposal is applied or undone. The auto-coach, suggestions and insights still build their own. Opening the panel warms it through the welcome. |

Checked beyond the unit suite for I23: the feedback storage against Postgres (owner-only, visible replies only, the CHECK), `script/chat-quality-report.ts` against seeded proposals and replies, and the built app in Chromium at desktop and phone width: a saved rating shown pressed, Not helpful saved (`PATCH` 200, stored with its time), and the chosen thumb pressed again clearing it in the database. For the earlier items: an integration test against Postgres applies a proposal, edits a day, undoes it and finds the cleared exercise table back row for row and the athlete's edit kept; and the built app, seeded with a real plan and a two-change proposal, was driven in Chromium at desktop and phone width: the welcome ("Hi Sam! Race day is 17 days away. Today: Intervals.") and its chips, a change toggled off, "Apply 1 change", the applied card with "Not applied" and Undo, the timeline moving the long run, and Undo putting it back.

Behaviour changes:

- **An applied proposal can be taken back** for a week after the apply, from its card. Proposals applied before migration 0112 can't be.
- **The chat's training context can be up to five minutes old** when nothing dropped it. Writes in the same instance drop it at once; on a deployment with more than one instance, a write on another instance shows up when the five minutes run out.
- **Opening the Coach panel makes one more request** (`GET /chat/welcome`), which builds the training context or reuses the cached one.
- **Long sessions cost one fast-model call about every ten turns** past the first 30 (`chat_rolling_summary`), and the coach reads up to 30 turns in full instead of 20, still within the 30,000-character budget.
- **Coach replies show thumbs.** Rating is optional and saved per reply; clearing it deletes the rating. The Coach panel's apply and undo confirmations get them too once reloaded: they are saved as ordinary assistant rows, with no kind of their own. Every streamed turn now writes one more info log line.
- **The scenario evals have not been run against a live model.** This environment has no provider key; the harness was exercised end to end without one (the failure path and the report). Run `pnpm eval:chat` before relying on them, and before turning on `AI_CHAT_TOOLS`.
- **Nothing changes for the coach until `AI_CHAT_TOOLS=true`.** With it on, a reply can take up to four model calls (three rounds of lookups, then the answer), each billed as `chat_stream`, and plan changes depend on the model choosing to call the tool rather than on the classifier. No live model has been run against it: turn it on after the scenario evals (I22).
- **Workout chats leave the Coach panel.** Turns sent from a workout's chat (saved with its ids since migration 0111) now show only in that workout's chat, and the Coach panel's coach no longer reads them. Older turns, saved without the ids, stay in the general conversation.

**Deliberately not changed:**

- **I1 uses message ids, not a `conversationId`.** Threads (I4) are keyed by the workout ids each row already carries.
- **I3 is partial.** The `suggestions`, `safety` and `system` kinds, and the model and latency columns, are not added: latency is in the `[chat] turn` log line instead (I23), and feedback has its own columns. Suggestion cards still float at the end of the Coach panel: they are not chat turns.
- **No GFM elsewhere.** The other markdown surfaces (coach insights, race predictor, chart explanations, nutrition insights) still render without GFM.

**After wave 3 (daler91/Hyrox-Companion#2088 merged): I24, I21 and I11.**

| ID  | Fix |
| --- | --- |
| I24 | `sanitizeUserInput` escapes only `&`, `<` and `>`: text still cannot break out of the prompt's `<user_input>`-style delimiters, and quotes and apostrophes reach the model as typed ("can't", not `can&#39;t`). `sanitizeHtml`, which emails and other HTML use, still encodes both. |
| I21 | While a reply streams, its text is `aria-busy` and `aria-live="off"`, so the conversation's polite live region stops re-reading it on every flush; once complete it mounts as a new node and is read once. The safety notice, which arrives before any text, sits outside that and is announced at once. Both chat surfaces. |
| I11 | The chat stream sends `{ status }` steps (`shared/chat.ts`) in place of `planProposalPending`: drafting plan changes, and on the tools path each lookup (workouts, exercise history, personal records, coaching notes), then back to thinking once it returns. The chat shows "Reading your training log..." until the server accepts the send, then "Thinking..." and the steps. A plan proposal's summary streams as the model writes it (`server/utils/jsonStringFieldReader.ts` reads `summaryMessage` off the JSON as it arrives), and the card follows once the whole proposal is checked. |

Behaviour changes:

- **A proposal's first words arrive sooner.** Its summary streams instead of arriving with the card, so the text starts as soon as the model writes it rather than after the changes.
- **A failed proposal stream is handled by how far it got.** One that fails before its summary begins makes the ordinary call, which retries. One that fails partway through the summary ends the reply with "I couldn't draft that change just now..." rather than a prose answer under the half-written summary.
- **Quotes reach the model as typed** in every prompt built from athlete or coach text. The escape checks in tests now pin `&lt;`, `&gt;` and `&amp;` only.
- **Screen readers hear a streamed reply once**, when it completes.
- **A tab open across the deploy shows "Thinking..."** where it used to show "Reviewing your plan...": it doesn't know the new status event.

Not run: a live model, so neither the streamed summary nor the status steps have met a real provider. The stream reading is unit-tested chunk by chunk, including Anthropic's code fence and escapes split across chunks.

**After daler91/Hyrox-Companion#2092 merged: the coach knows what it changed.**

An athlete's report, with auto-apply on. Asked "Move my long run to Sunday this week", the coach moved it from Monday (an earlier change had already swapped it there from Saturday). Asked to undo that, it asked the athlete for the original dates. Told "Long run was Saturday... not sure what you did with Monday's original workout", it moved the long run back but couldn't say what had happened to Monday's session, and the timeline showed "Week 6" between two week-5 days.

| Fix | What changed |
| --- | --- |
| A record of plan changes | The chat coach and the plan-change step read the proposals applied in the last 14 days, undone ones included, with each session's date before and after (`server/services/recentPlanChanges.ts`, `server/prompts/recentPlanChanges.ts`). Each is dated by the athlete's day ("today", "2 days ago"), not the minute, so the chat's system prompt stays the same from turn to turn. Both are told to undo a listed change by putting each session back on its "from" date, to answer "what happened to X" from it, and never to ask the athlete for a date it lists. "Undo", "revert", "put it back", "change it back" and "back to how it was" now open the plan-edit gate, and the classifier counts an undo as a plan change. |
| Weekdays on dates | Every date the coach and the plan-change step read carries its weekday: the workout lists ("2026-10-04 (Sunday, in 2 days)"), today's date, absences, skips, missed sessions and the next planned session. Before, each "Sunday" was arithmetic on an ISO date. |
| Week and weekday follow a move | Every write that gives a plan day a new date also sets that date's week and weekday (`server/storage/planSlot.ts`): applying or undoing a proposal, a move with a status change, missed-session recovery and its undo. The workout engine's plan phase, plan repair's race-week skip and session-grade rollups read the right week, and rescheduling the plan keeps moved sessions where they are. Migration `0117` repairs the days moved before. |
| Evals | Four scenarios: undoing the coach's last change, "what happened to Monday's workout?", the weekday of a planned session, and "move my long run to Sunday" with tools. |

Behaviour changes:

- **"Undo that" restores what the last card changed**, as a new proposal (applied at once with auto-apply on), or the coach points to the card's Undo.
- **Changes made outside chat stay invisible to the coach.** A move on the timeline or a missed-session reschedule isn't recorded anywhere it reads, and it says so.
- **Week badges match the calendar** after a move, including for sessions moved before this change once migration `0117` has run.

Not run: a live model, for the new scenarios as for the rest. The migration is tested on a real database: the athlete's case (Strength and Wall Balls moved from week 6's Monday to Sunday, Rest from week 5's Sunday to Monday) comes back as week 5 Sunday and week 6 Monday, and a second run changes nothing. A day moved ahead of week 1 is filed under the first week, as the app files a new move there.

**After daler91/Hyrox-Companion#2093 merged: the athlete's own moves, and longer messages with photos (I20).**

| Fix | What changed |
| --- | --- |
| The athlete's own moves | A new table, `plan_day_moves` (migration `0118`), records each move the athlete makes outside the coach's proposals: a new date on the timeline or in the edit sheet, a move with a status change, a missed session rescheduled whole or shortened, and taking one back (`server/services/planDayMoves.ts`). A drag corrected within 15 minutes is one move, and one put straight back is none. The coach's record of plan changes lists them beside its proposals, newest first. A move has no Undo card: putting it back means moving the session to its "from" date, and the read-only coach says they can drag it back on the timeline. A nightly job drops moves older than 30 days. |
| Longer messages (I20) | `CHAT_MESSAGE_MAX_LENGTH` is 4,000, up from 1,000; the input's counter still shows near the limit. |
| Photos in chat (I20) | One photo per message, from the gallery or the camera. Gemini vision reads it into words for the coach (`server/services/chatPhoto.ts`), alongside the context build; the coach reads the reading after the message, marked as data, and the safety scan reads it with the athlete's words. The turn keeps the reading as `attachment` (migration `0119`), never the image, and the chat shows "Photo attached" with what the coach read. A photo that can't be read refuses the send with `CHAT_PHOTO_UNREADABLE` before anything is saved, and Retry sends it again. |

Behaviour changes:

- **The coach sees moves made on the timeline and on a missed session's card**, with the dates before and after. Rescheduling the whole plan to a new start date still isn't listed.
- **Every move by the athlete writes one small row**, and the chat's record read makes one more query (and reads the athlete's time zone only when something changed).
- **Chat messages can be four times longer**, so long ones cost more tokens per turn and fill the history window sooner.
- **A photo costs one more Gemini vision call**, billed as `parse`, and works only where Gemini is configured, like the other photo parsers. The chat send routes accept a 5 MB body instead of 100 KB.
- **What a photo shows counts for the safety scan.** A red flag or a heart-rate medication in it brings the same notice and guidance as typed words, and a red flag stops a plan change or a fact offer on that turn.

Not run: a live model, so neither the photo reading nor the new eval scenario has met a real one. The moves table is tested against Postgres: merging a corrected drag, keeping separate moves after the window, pruning, and a deleted session's moves going with it.

---

## How a chat turn works today

```
ChatInput → useChatSession.sendMessage
  ├─ POST /api/v1/chat/message   save the user turn (before the request is accepted)
  └─ POST /api/v1/chat/stream    { message ≤1000 chars, history: last 20 turns ≤30k chars, focusPlanDayId? }
       aiConsentCheck → aiBudgetCheck → validateBody
       buildAIContext = buildTrainingContext ∥ retrieveCoachingContext (embed query → top-6 chunks)
       flush headers → SSE { ragInfo }
       hasPlanEditKeywords? → classifyPlanEditIntent (fast model)              ← runs after the context build
         └─ plan_modification ≥ 0.7 → createPlanAdjustmentProposal (reasoning model, JSON, not streamed)
                                      → SSE { text: summary } { planProposal } { done }
       otherwise streamChatWithCoach (reasoning model, global effort "high") → SSE { text }… { done }
  └─ POST /api/v1/chat/message   save the assistant turn (only if the stream finished in this tab)
```

---

## Defects — fix first

### D1 · Confirming a change the coach offered does nothing · S

`hasPlanEditKeywords` (`server/services/chatIntentService.ts:24-39`) looks only at the new message.
None of "yes please", "yes, do it", "sounds good, go ahead", "ok", "sure" or "do that" matches a
pattern (checked by running the patterns), so a confirmation never reaches the classifier and goes
through normal chat. The normal chat prompt (`BASE_SYSTEM_PROMPT`, `server/prompts.ts:30-65`) tells
the coach to discuss "whether modifications might help", but never says it can't apply them. So this
natural exchange:

> **Coach:** …want me to move your long run to Saturday?
> **Athlete:** yes please

ends with a reply that may say the change is done, when nothing changed.

**Fix.**

- (a) When the previous assistant turn offered a change, send short affirmations to the classifier
  with that turn as context. Today the classifier sees only the last two _user_ turns
  (`chatIntentService.ts:52-55`).
- (b) Add a capability line to `BASE_SYSTEM_PROMPT`: the coach cannot change the plan in a prose
  reply and must never say it has. It should tell the athlete to ask directly ("Move my long run to
  Saturday") to get a proposal card.

(b) alone removes the false claim, and it is a one-line change.

### D2 · No deterministic safety layer on chat · S

`analyzeSafetySignals` (`server/services/aiSafety.ts:89-111`) scans recent and upcoming workout text.
It runs for auto-coach suggestions, review notes and plan proposals, but `/chat` and `/chat/stream`
never call it, and nothing scans the chat message itself. "I've had chest pain on my last two runs,
should I still do tomorrow's intervals?" gets whatever the model decides, and the chat prompt has no
medical-safety guidance. The plan-edit branch checks workout text only, so the same message phrased as
a change ("skip tomorrow, I had chest pain") produces a proposal and no escalation.

**Fix.** Run `RED_FLAG_SYMPTOM_PATTERNS` and `HR_MEDICATION_PATTERNS` over the message and the last
user turn. On a hit:

- send the existing `ESCALATION_MESSAGE` as its own SSE event, rendered as a banner above the reply.
  It adds to the reply rather than replacing it, so a false positive ("a faint chance") costs a
  banner, not the answer;
- add a prompt line telling the coach to put medical care first and not to prescribe hard training;
- run the same check before `createPlanAdjustmentProposal`.

Add a short MEDICAL SAFETY paragraph to `BASE_SYSTEM_PROMPT` either way.

### D3 · The Coach panel shows some replies above the question · S

`CoachPanel` merges hook and local messages and sorts them by `createdAtMs ?? 0`
(`client/src/components/CoachPanel.tsx:105-112`). Some messages are created without `createdAtMs`:
the suggestions reply and its error messages (`client/src/components/coach/SuggestionsTab.tsx:41-46`),
and the plan-proposal confirmations (`client/src/hooks/usePlanProposal.ts:82-87`). They sort as 0,
ahead of every message sent in this session. Tapping _Get workout suggestions_ shows "I have 3
suggestions…" above the "Get workout suggestions" bubble (reproduced with a copy of the
merge-and-sort). A reload hides the problem, because hydrated history also has no `createdAtMs` and
keeps server order.

**Fix.** Set `createdAtMs: Date.now()` on every locally created message (and derive it from
`msg.timestamp` on hydrated ones), or drop the sort and keep insertion order. The longer-term fix is a
single message store (I1).

### D4 · Every chat failure says "Something went wrong on our side" · S

`useChatSession` sorts failures into abort, network and other (`client/src/hooks/useChatSession.ts:39-56`).
All of these become "other":

- the daily AI cap (`AiBudgetExceededError`);
- the 10-per-minute rate limit (`RateLimitError`);
- a message over 1000 characters (400). `ChatInput` has no `maxLength` and no counter
  (`client/src/components/ChatInput.tsx:94`);
- AI consent switched off (403);
- the server's named stream endings, `auth-expired` and `timeout`. Each is sent with a readable
  `reason` (`server/routes/ai.ts:399-417`), but `consumeSSEStream` throws `new Error(data.error)` and
  drops it (`client/src/lib/sseStream.ts:59-61`).

The suggestions flow already handles these with `describeAiError`. The main chat doesn't use it.

The user turn is saved before the server accepts the request (`useChatSession.ts:312`). Each failed
send (for example a too-long message retried a few times) leaves a user message with no reply, and
the next turn's history then has two user turns in a row.

**Fix.**

- Route chat errors through `describeAiError`, and carry `reason` through from the SSE error event.
- Add `maxLength={1000}` and a counter to `ChatInput`.
- Save the user turn only after the server accepts the request (or server-side, see I1), and give a
  failed message a Retry action instead of adding a new bubble.
- Show the budget warning the server already sends (`X-AI-Budget-Warning`,
  `server/middleware/aibudget.ts:59-61`). The client never reads it.

### D5 · The workout chat doesn't tell the coach which workout is open · M

The workout-detail chat sends `focusPlanDayId`, but only the plan-edit branch uses it
(`server/routes/ai.ts:333`). Normal chat, including the seed question "Can you walk me through your
take on my _X_ workout on _date_?" (`EmbeddedWorkoutCoachChat.tsx:26-39`), gets only the general
training context. That context lists the last 7 workouts and the next 7 planned days
(`server/prompts/coachingContext.ts:102,121`). A session outside those windows is invisible, and the
coach answers from the seed text alone. Ad-hoc logged workouts have no `planDayId`, so nothing
identifies them at all. The non-streaming fallback drops `focusPlanDayId` as well
(`useChatSession.ts:375-378`).

**Fix.** Accept `focusWorkout: { planDayId?, workoutLogId? }` on the chat request, load the workout
server-side with an ownership check, and render a FOCUSED WORKOUT block into the chat prompt:

- the prescription next to what was logged (sets, RPE, duration, device heart rate and pace);
- the athlete note, adherence snapshot and session grade;
- any coach note and its rationale.

### D6 · The chat sees less than the auto-coach · S

The two prompt assemblers have drifted apart on per-session detail:

| Data                  | Auto-coach (`server/gemini/suggestionService.ts`)                                   | Chat (`server/prompts/coachingContext.ts`)                         |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Recent workouts       | last 10, with RPE and duration (`:182-183`)                                         | last 7, without RPE or duration (`:99-116`)                        |
| Upcoming days         | prior AI review, last AI modification, last fatigue reduction (`:202-252`)          | none, so "why did Thursday change?" can't be answered              |
| Max weight / distance | with units                                                                          | no units (`:90-91`; already logged as REFACTORING_REVIEW D1)       |

The chat prompt has three smaller inaccuracies:

- A brand-new plan with nothing due yet shows "Completion rate: 0%" (`trainingStats.ts:31` →
  `coachingContext.ts:49`), which invites a day-one lecture about consistency.
- "Upcoming Planned Workouts (next 7 days)" is really the next 7 planned _sessions_
  (`services/ai/index.ts:494`). For a plan without rest-day rows, that covers two weeks.
- The athlete's unit preference is never stated, although `BASE_SYSTEM_PROMPT` asks for loads "in
  the athlete's unit". The zero-workout branch has no unit information at all.

**Fix.**

- Render RPE, duration and prior-AI context in the chat builders, or share the suggestion renderers
  outright, as `formatAthleteConstraints` and `formatMafContext` already are.
- Print "n/a — nothing due yet" when the completion denominator is 0.
- Fix the upcoming-workouts label.
- Add a `Units: kg, km` line.

Extend the existing prompt-inclusion tests so the two assemblers can't drift apart again.

---

## Improvements

### Conversation model and memory

**I1 · Make the server own the conversation · M–L.** Today the browser uploads up to 30k characters
of history with every message and saves turns through separate `POST /chat/message` calls. This has
four consequences:

- A reply that finishes after the tab closes is generated and billed, but never saved.
- Failed sends leave orphan turns (D4).
- A client can replay any "assistant" turns it likes. They are sanitised, but the client still
  chooses what the model reads.
- The Coach panel's local messages (suggestion results, apply confirmations) never enter the hook's
  history. Later in the same session, the coach doesn't know what it just suggested or what was
  applied.

Persist both turns inside `/chat/stream`, saving the assistant turn on completion _or_ abort. Load
history from the database, and have the client send `{ message, conversationId }`. One React Query
store then feeds every chat surface.

**I2 · Make history time-aware, and start fresh sessions · S–M.** The chat is one thread that never
ends, and the model receives history without timestamps (`server/gemini/chatService.ts:10-33`). A
knee complaint from three weeks ago, still inside the last 20 turns, reads as current. Prefix turns
with a relative time, or insert a marker like "— 19 days later —". After a long gap (say 12 hours),
start a new session that carries a short summary forward instead of raw turns. The UI needs date
separators too: timestamps show the time of day only.

**I3 · Give messages metadata, and render cards inline · M.** `chat_messages` holds only `role`,
`content` and `timestamp` (`shared/schema/tables.ts:1316-1338`). Add `kind` (text, proposal,
suggestions, safety, system), `proposalId`, the focus workout, `ragSource`, model, latency and
feedback. Proposal and suggestion cards can then render inline at the turn that produced them, with
their final status (applied, dismissed, stale). Today they float at the bottom of the panel while
pending and disappear from history afterwards.

**I4 · Separate threads for workout chats · M.** The workout-detail chat loads the whole global
history and writes into it. A question about Tuesday's session therefore shows unrelated
conversations, and sends them to the model. Once I1 and I3 are in place, give each workout its own
thread. At minimum, render an "About: Lower Strength · Tue 29 Sep" divider and send only that
thread's turns.

**I5 · Rolling summary and chat-proposed athlete facts · M.** After 20 turns the coach forgets
everything. A rolling summary (fast model, refreshed every N turns) is cheap. Separately,
`coach-memory-spec.md` Path C is still open. When the athlete states a lasting fact in chat ("no sled
at my gym"), propose it as a fact card for the athlete to confirm. The register already says inferred
facts must be proposed and never written silently.

### Plan editing from chat

**I6 · Apply changes one by one, and allow undo · M.** `PlanProposalCard` offers only _Apply all
changes_. A request for one change that comes with four rebalancing edits is all or nothing. Add a
toggle for each change. Then add Undo. Each change's `baseline` already stores the text fields, date,
duration, RPE and status, so restoring those is one transaction. Table-backed days also need their
exercise rows saved at apply time, because `baseline` keeps only a fingerprint of them. Undo matters
most with `coachAutoApplyPlanChanges`, which applies changes without a click.

**I7 · Tell the coach what happened · S.** Dismissing a proposal is silent
(`usePlanProposal.ts:119-124`). Apply confirmations are local messages that never reach the hook's
history. So on the next turn the coach doesn't know whether the athlete took the proposal. Record
apply, dismiss and stale as conversation events the model can see.

**I8 · Function calling instead of keyword gate plus classifier · L.** The current flow is a keyword
regex, then a fast-model classifier, then a separate JSON generation. Give the reasoning model a
`propose_plan_changes` tool (backed by the existing proposal pipeline) and read tools:
`get_workouts(range)`, `get_exercise_history(exercise)`, `get_personal_records` and
`search_coaching_materials(query)`. Then:

- one call decides with the full conversation as context, which fixes D1 at the root;
- the coach can answer questions the 10-workout window can't, such as "what did I squat in July?";
- the prompt that goes out on every turn gets smaller.

This needs tool support in `TextAiProvider`. The Gemini, Anthropic and OpenAI-compatible APIs all
offer it.

### Latency and cost

Time to first token is currently the sum of: the budget check, the full context build, the query
embedding, often a classifier round trip, and high-effort thinking on the reasoning model.

**I9 · Run the classifier alongside the context build · S.** `classifyPlanEditIntent` needs only the
message and history, yet it starts only after `buildAIContext` resolves (`server/routes/ai.ts:421,445`).
In a quick sample, the keyword gate let through 5 of 12 ordinary questions ("What should I do
tomorrow?", "How should I pace my race?", "My legs are sore, is that normal?"…). Each of those waits
for the round trip in sequence. Start the classifier in parallel.

**I10 · Set reasoning effort per feature · S.** `chatService` doesn't pass `reasoningEffort`, so chat
inherits the global `AI_TEXT_REASONING_EFFORT`. Its default is `high` (Gemini `ThinkingLevel.HIGH`),
the same as plan generation. The per-request override already exists, and the parsers use it.
Default chat to `medium`, keep `high` for plan generation and adjustment, and consider the fast model
for short conversational messages. The intent classifier runs on the fast model but also inherits
`high`, whereas the exercise and meal parsers pass `none`. The classifier should pass `none` too.

**I11 · Progress events · S.** Turn the existing `planProposalPending` event into a general `status`
event with steps such as "Reading your training log…" and "Checking your plan…". During a long think,
the dots are currently the only feedback. Stream the proposal summary instead of waiting for the
whole JSON.

**I12 · Cache the training context · M.** `buildTrainingContext` runs again on every turn: about seven
parallel reads, plus nutrition and MAF. The coach-memory spec calls it the heaviest uncached read.
Cache it per user for a few minutes, and invalidate the cache on workout and plan writes.

**I13 · Prompt caching on Anthropic · S.** The system prompt is large and stays the same within a
conversation, but the Anthropic adapter sends no `cache_control`. The RAG excerpts sit at the end of
the prompt, which keeps everything before them cacheable. Keep it that way.

### Retrieval

**I14 · Retrieve only when it helps · S.** Every message, "thanks!" included, costs an embedding call
and adds six chunks to the prompt: up to 3 pinned principles plus nearest neighbours, with no
similarity threshold (`server/services/ragService.ts:194,341`). Skip retrieval for short social
messages, and add a distance cut-off for the semantic results (keep the pinned ones).

**I15 · Retrieve for the conversation, not just the last message · S.** The search query is the raw
new message. A follow-up such as "what about for the sled?" searches for exactly that phrase. For
short messages or ones that start with a pronoun, prepend the previous user turn, or have the fast
model write a standalone query.

**I16 · Cite sources · S.** Excerpts are labelled `[Excerpt 1]` with no title
(`server/prompts/materialsBuilder.ts:55`), and the only trace in the UI is a dev-only badge. Label
each excerpt with its material title, let the coach cite it, and show a small "From your coaching
notes" chip. That chip is the visible payoff for uploading materials.

### Chat UX

**I17 · Render GFM · S.** `ReactMarkdown` runs without `remark-gfm`
(`client/src/components/ChatMessage.tsx:49`). Tables are the natural format for pacing splits and
weekly schedules, and they currently show up as raw pipe characters.

**I18 · Message actions · S–M.** Add copy, regenerate, thumbs up/down with an optional reason, Retry
on a failed turn, and editing the last message.

**I19 · Contextual welcome and quick actions · S.** The welcome message is fixed, and so are the
quick-action lists (`CoachPanel.tsx:18-43`). Two of the actions are generic ("Pacing tips", "Exercise
form tips"). Build them from today's session, readiness and load-governor state, an upcoming race or
a new personal record, for example "Today: 6×800 m @ 4:05/km — want pacing cues?". Greet the athlete
by first name.

**I20 · Input · S–M.** 1000 characters is tight for a race recap or a pasted session. Raise the limit
for chat and show a counter (D4). Photo attachments could reuse the existing image parsing ("here's
my watch screenshot, how was my pacing?").

**I21 · Streaming and screen readers · S.** The whole conversation is a polite live region
(`CoachPanelChatArea.tsx:65`), and its content changes on every animation-frame flush. Mark the
streaming message `aria-busy`, and announce it once when it completes.

### Quality loop

**I22 · Scenario evals · M.** `server/services/aiEval.test.ts` has two keyword checks and is off by
default. Add golden conversations graded by an LLM judge, covering:

- red-flag escalation;
- respecting the load governor and taper in chat;
- never claiming a change that wasn't applied, including the "yes please" flow;
- using the athlete's units and the focused workout;
- refusing to reveal the prompt.

Run the suite on every prompt or model change.

**I23 · Telemetry and feedback · S–M.** Log time to first token, the classifier's hit and
false-positive rates, the proposal apply, dismiss, undo and stale rates, the regenerate rate, and
thumbs ratings. Today `ai_usage_logs` records cost per feature and nothing about whether the answers
helped.

### Prompt hygiene

**I24 · Escape less · S.** `sanitizeUserInput` is `sanitizeHtml`, so every user and assistant turn
is HTML-entity-encoded. "can't" reaches the model as `can&#39;t`, and quotes become `&quot;`
(`server/utils/sanitize.ts:8-27`). That costs tokens on every turn, and the model sees its own past
replies in encoded form. Escaping `<`, `>` and `&` is enough to stop text breaking out of
`<user_input>`. Encoding quotes and apostrophes adds nothing in a prompt.

---

## Suggested order

| Wave                          | Items                                       | Why                                                                                    |
| ----------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1 — small, user-visible       | D1(b), D2, D3, D4, D6, I9, I10, I17         | Defects and one-line wins. Each is S and can ship on its own                            |
| 2 — context and conversation  | D5, D1(a), I1–I3, I6, I7, I14–I16, I19      | The coach sees what it's asked about, and the server owns a coherent conversation       |
| 3 — architecture              | I8, I4, I5, I12, I22, I23                   | Tool calling, threads, memory and evals: larger pieces, easier once wave 2 is in place  |

---

## Not verified

- No live model calls were made. Whether the coach actually claims a change it didn't make (D1), or
  mishandles a red-flag message (D2), depends on the model. The gaps are in the code; those outcomes
  are risks, not observations.
- Latency was not measured. I9–I12 are reasoned from the order of calls.
- Whether the fast Gemini model accepts the inherited `thinkingLevel` (I10) was not tested.
