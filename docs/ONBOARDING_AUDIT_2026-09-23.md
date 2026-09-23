# Onboarding Audit — 2026-09-23

**Scope:** the first-run experience from sign-in to the first useful Timeline. That covers the onboarding
wizard (`client/src/components/OnboardingWizard.tsx`, `client/src/components/onboarding/`,
`client/src/hooks/useOnboarding*.ts`), how Timeline triggers it, the Settings "Run setup again" entry
point, and the server routes it calls (preferences, plan sample, schedule and generate, and the AI
consent gate).

**Method:** first, the wizard code paths were read end to end. Then the app was run locally: dev auth
bypass, a fresh Postgres, and the `dev-user` row deleted before each run so every run started as a
brand-new account (`aiCoachEnabled = false`, `onboardingCompleted = false`, no plans). Every wizard
path was driven with Playwright at 1280×800 and 375×667. Each finding marked **verified** was reproduced
in the running app; the rest are from reading the code. No application code was changed.

**Headline:** the wizard is well structured, but three defects mean almost no new user gets the
intended first run today:

1. **The recommended plan option always fails.** "Generate AI Plan (recommended)" fails for every new
   account (403 AI consent) and shows a raw JSON error.
2. **Units are lost.** The default gender answer, "Prefer not to say", is 17 characters and the
   column is `varchar(16)`, so the Units step's save returns 500. Settings saves fail for the same
   users, so the "update them later in Settings" fallback is broken too.
3. **The template starts with missed workouts.** The 8-week template, started "tomorrow" as the
   wizard suggests, is backdated to that week's Monday. Anyone who signs up Tuesday–Saturday sees one
   to five red **Missed** workouts before they have done anything.

All 22 onboarding unit tests pass and the Cypress onboarding spec is green. Both stub the exact layers
where these failures happen (see [Test coverage gaps](#test-coverage-gaps)).

---

## How the flow works today

```
Landing ──(Clerk modal sign-in)──▶ "/" Timeline
   useOnboarding: show wizard when isNewUser (no plans AND no timeline rows)
                  AND server onboardingCompleted = false AND no local flag
        │
        ▼
 1 Welcome ─▶ 2 Units ─────────▶ 3 Goal ───────────▶ 4 Fuelling (optional) ─▶ 5 Plan
   (static)    PATCH units,        PATCH training       PATCH body profile +       │
               division, gender    style (+MAF)         nutrition target           │
                                                                                   ├─ Generate AI Plan (recommended) ─▶ 3-step dialog ─▶ POST /plans/generate
                                                                                   ├─ Use 8-Week Template ─▶ 6 Schedule ─▶ POST /plans/:id/schedule
                                                                                   ├─ Import Your Own Plan ─▶ wizard closes, file picker opens
                                                                                   └─ Skip ─▶ empty Timeline
 Esc / ✕ at any step = Skip (marks onboarding complete)
```

---

## Findings at a glance

| ID    | Severity | Finding                                                                                          | Who hits it                                   | Verified |
| ----- | -------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------- |
| C1    | Critical | Recommended "Generate AI Plan" path always 403s for new users; raw JSON toast; dead end          | Every new user who follows the recommendation | ✅       |
| C2    | Critical | Default gender value overflows `varchar(16)` → Units save 500s; Settings saves also 500          | Every user who keeps "Prefer not to say"      | ✅       |
| C3    | Critical | Template plan backdated to Monday → 1–5 "Missed" workouts on day one; copy promises another date | Template users signing up Tue–Sat             | ✅       |
| H1    | High     | Plan step overflows the dialog by ~120 px on phones; options and Skip are cut off                | Every phone user                              | ✅       |
| H2    | High     | "Run setup again" ignores saved prefs and overwrites units, division, gender, training style     | Established athletes who re-run setup         | ✅       |
| H3    | High     | Back from Schedule → template again creates a duplicate, never-scheduled plan                    | Anyone who goes back on the last step         | ✅       |
| H4    | High     | One Esc / ✕ press permanently completes onboarding, with no confirmation or pointer back         | Anyone who dismisses by reflex                | ✅       |
| M1    | Medium   | Import path: cancelling the file picker restarts the wizard later, reset to defaults             | Import users without a CSV to hand            | ✅       |
| M2    | Medium   | Progress counter moves the finish line (5/5 → 6/6); AI path hides a 3-step sub-wizard            | All                                           | ✅       |
| M3    | Medium   | Goal answer is discarded; age only saved via optional step; race date never asked                | All                                           | code     |
| M4    | Medium   | Accessibility: unnamed radio groups, placeholder-only label, toast-only validation, focus        | Screen-reader and keyboard users              | ✅       |
| M5    | Medium   | Privacy notice is suppressed while the wizard collects health data, then stacks and blocks UI    | All                                           | ✅       |
| M6    | Medium   | AI coach, the core product, is never introduced or consented to during onboarding                | All                                           | code     |
| L1–L7 | Low      | Polish and consistency items                                                                     | Varies                                        | mixed    |

---

## Critical

### C1 — The recommended plan path fails for every new account

**What happens (verified):** a new account walks Welcome → Units → Goal → Fuelling → Plan and clicks
**Generate AI Plan (recommended)**. They fill in the dialog's three sub-steps and click **Generate Plan**.
The request is sent twice and returns `403 AI_COACH_DISABLED` both times. The toast reads:

> **Failed to generate plan**
> `403: {"error":"AI coaching is disabled for this account. Enable it in Settings before using AI features.","code":"AI_COACH_DISABLED"}`

Both the generate dialog and the wizard stay open. Settings can't be reached without abandoning
onboarding, and closing the wizard marks onboarding complete (H4).

**Why:**

- New users are created with `aiCoachEnabled = false`: `server/clerkAuth.ts:172` and
  `shared/schema/tables.ts:105`.
- `POST /api/v1/plans/generate` is consent-gated: `server/routes/plans.ts:167` (`aiConsent: true`).
- The wizard has no consent step, and `GeneratePlanDialog` never checks consent before submitting
  (`client/src/components/plans/GeneratePlanDialog.tsx:78-86`).
- `getGeneratePlanErrorToast` shows `error.message` verbatim instead of going through
  `humanizeApiError` (`client/src/hooks/usePlanGeneration.ts:26-29`).
- The duplicate request comes from `apiRequest` retrying every mutation 403 as a possible CSRF
  rotation (`client/src/lib/queryClient.ts:176-181`).

The same dialog is the primary call to action on the empty Timeline, so users who skip hit it there
too (`client/src/components/timeline/TimelineEmptyState.tsx:78-85`).

**Precedent:** nutrition had this exact bug and fixed it. The comment in
`client/src/pages/nutrition/useAiConsentGate.tsx:9-19` reads: "used to surface as a dead-end error
toast on a brand-new user's very first 'Describe a meal' attempt". Plan generation never got the gate.
The Cypress spec's comment, "8-Week Sample Plan should be the primary CTA now"
(`cypress/e2e/onboarding.cy.ts:51`), shows the template was once the primary option. The spec only
asserts visibility, so the swap back to AI-first went unnoticed.

**Fix:**

1. Wrap the dialog's open/submit in `useAiConsentGate` so accepting consent resumes the generation.
   Better still, show the consent choice _before_ the three sub-steps, not after the athlete has
   filled them in.
2. Map `AI_COACH_DISABLED` (and all 4xx) through `humanizeApiError` in `getGeneratePlanErrorToast`.
3. Don't retry a 403 whose body carries a non-CSRF `code`.
4. Until consent is given, lead with the template, or label the AI option "needs AI coaching on".

### C2 — The default gender answer breaks the Units save, and Settings saves too

**What happens (verified):** clicking Continue on the Units step with the default "Prefer not to say"
selected returns **500**. The server logs:
`DrizzleQueryError … params: lbs,miles,open,prefer_not_to_say,… value too long for type character varying(16)`.
The wizard shows a red toast, "Could not save preferences — You can update them later in settings",
and moves on. The athlete's weight unit, distance unit and division are silently lost; a user who
picked lbs/miles is shown kg/km everywhere.

The suggested fallback fails too (verified). Settings always sends the full snapshot, and a null gender
is shown as `"prefer_not_to_say"`, so every Settings save returns 500 ("Failed to save settings. Please
try again.") for these users. Picking Men or Women is the only way out. An athlete who genuinely prefers
not to say can never save Settings.

**Why:**

- The column: `gender: varchar("gender", { length: 16 })` (`shared/schema/tables.ts:119`, migration
  `0056_magical_marvex.sql:2`).
- The validator allows the 17-character value: `z.enum(["male", "female", "prefer_not_to_say"])`
  (`shared/schema/types/users.ts:64`).
- The wizard's default: `useOnboardingWizard.ts:39`. The toast-and-continue path:
  `useOnboardingWizard.ts:191-203`.
- The Settings path: `client/src/pages/settings/preferencesSnapshot.ts:295`, `:343`, and
  `usePreferencesForm.tsx:205`.

**Fix:**

- A migration widening `users.gender` to `varchar(32)`. Keep the value rather than mapping it to null,
  because null means "not answered yet" (`tables.ts:116-117`).
- A DB-backed regression test that round-trips every enum value in `updateUserPreferencesSchema`.
- Every other enum/varchar pair on `users` was checked and fits (division 16, activity_level 24,
  weight_goal_direction 16).
- **Never ship the migration ahead of H2.** Land H2 first or in the same release. Right now this
  failure is what stops "Run setup again" from overwriting units, so the migration on its own would
  switch that overwrite on.

### C3 — The template plan starts with "Missed" workouts

**What happens (verified on a Wednesday):**

1. The Schedule step defaults to tomorrow and says "Your plan will start on Thursday, September 24".
2. After **Start Training**, the plan's `startDate` is **Monday September 21**.
3. The first screen after onboarding shows Monday's _Running Base_ and Tuesday's _Strength_ as red
   **Missed** cards above today's session.

**Why:**

- `schedulePlan` aligns week 1 to the Monday of the chosen week (`server/storage/plans.ts:382-384`,
  `:414`).
- A past planned day reads as `missed` at request time (`server/storage/timeline.ts:91`).
- The template schedules all seven days of week 1 (`server/samplePlan.ts:2-8`).
- The Schedule step never mentions Monday alignment, and it disables today (`ScheduleStep.tsx:16`,
  `:23`).

| Sign-up day | Default start (tomorrow) | Week 1 anchored to | Missed on first view            |
| ----------- | ------------------------ | ------------------ | ------------------------------- |
| Sunday      | Monday                   | that Monday        | 0                               |
| Monday      | Tuesday                  | today              | 0 (but today's session appears) |
| Tuesday     | Wednesday                | yesterday          | 1                               |
| Wednesday   | Thursday                 | 2 days ago         | 2                               |
| Thursday    | Friday                   | 3 days ago         | 3                               |
| Friday      | Saturday                 | 4 days ago         | 4                               |
| Saturday    | Sunday                   | 5 days ago         | 5                               |

The weekly review also counts them as missed sessions (`server/services/weeklyReviewService.ts:84-99`).

**Fix (pick one):**

- **Onboarding only:** default to the next Monday (or today if it is Monday), and restrict or explain
  the calendar: "Plans run Monday–Sunday".
- **Everywhere:** have `schedulePlan` never place a day before the requested start date, either by
  rotating week 1 to begin on the chosen weekday or by leaving earlier days unscheduled.

Either way, let today be chosen (`ScheduleStep.tsx:23` currently disables it). The wizard's copy must
state the date the server will actually use.

---

## High

### H1 — Plan step overflows on phones (verified)

At 375 px the dialog is 343 px wide, but the Plan step's content is 486 px wide. Each option button is
436 px and ends at x = 479, about 120 px past the screen edge. On a phone the descriptions ("…based on
your goals, schedule,"), the right half of the progress bar, and the Skip link ("…log workouts man") are
cut off.

**Cause:** the shared `Button` base class includes `whitespace-nowrap`
(`client/src/components/ui/button.tsx:8`). The option buttons (`PlanStep.tsx:22-76`) put two lines of
copy inside it, and the dialog's grid layout grows to the unwrapped width.

**Fix:** add `whitespace-normal` and `min-w-0` to these buttons, or render the options as cards rather
than `Button`s. Add a 375 px visual or overflow assertion.

On phones the Continue and Start Training buttons also sit below the fold on the Goal and Schedule steps.
A sticky footer would keep the primary action visible.

### H2 — "Run setup again" overwrites an established athlete's settings (verified)

The athlete in this test had lbs, miles, Pro, female and MAF saved. The re-run wizard opened with kg,
km, Open and Balanced selected. Clicking Continue twice:

- switched `trainingStyleId` from `maf_method` to `balanced_default`;
- with a gender picked, so the Units save succeeds (C2), also reset lbs → kg, miles → km, Pro → Open.

**Why:**

- The wizard's state is hard-coded defaults (`useOnboardingWizard.ts:36-47`), not the saved
  preferences.
- Each step saves the whole step's fields (`:193`, `:214`).

In the same re-run, the generate dialog is opened without `existingPlans` (`OnboardingWizard.tsx:175-182`).
That skips the "archive the plan this overlaps" offer at exactly the moment the athlete is switching
plans. The Settings card advertises "pick a different training plan" as the reason to re-run
(`client/src/pages/Settings.tsx:163-184`).

**Fix:**

- Seed the wizard from `/api/v1/preferences`.
- Send only the fields the athlete changed.
- Pass `existingPlans` whenever the athlete already has plans.

### H3 — Going Back on the Schedule step duplicates the plan (verified)

**Steps:** Template → Schedule → **Back** → Template → Start Training.

**Result:** two "8-Week Functional Fitness Plan" rows; the first is never scheduled. The same orphan
is left if the athlete goes back and picks AI or Import instead.

**Why:**

- Back is shown on Schedule (`OnboardingWizardFooter.tsx:25`, `PREV.schedule = "plan"` in
  `useOnboardingWizard.ts:28-30`).
- Each template click creates a new plan (`useOnboardingWizard.ts:73-81`).

**Fix:** reuse `createdPlanId` when it is already set. If the athlete switches away from the template,
delete it or offer to.

### H4 — A single Esc or ✕ ends onboarding for good (verified)

Pressing Esc on the Welcome step closes the wizard and sets `onboardingCompleted = true` on the server.
No toast appears and the wizard doesn't return after a reload. The same happens with the dialog's ✕ at
any step (`OnboardingWizard.tsx:90-96` → `useOnboardingWizard.ts:242-255`). Backdrop clicks are
deliberately blocked (`OnboardingWizardFrame.tsx:41`), but Esc and ✕ are not.

**Fix:**

- Treat a dismissal before the Plan step as "remind me later": don't set the flag, or set a snooze.
- Or confirm with "Finish setup later? You can restart it from Settings → Getting Started".
- Always show a toast naming where "Run setup again" lives.

---

## Medium

### M1 — Import path: cancelling or failing the upload loops back to a reset wizard (verified)

**Import Your Own Plan** closes the wizard and opens the file picker (`useOnboarding.ts:83-89`).
Onboarding is only marked complete when an import succeeds (`:98-102`).

If the athlete cancels the picker, which is likely since the step only says "Upload a CSV training plan"
and offers no template or format help, they land on an empty Timeline. After a reload the wizard starts
again from Welcome, with default values. Because of H2, clicking Continue then overwrites what they
chose the first time.

**Fix:**

- Keep the wizard open behind the picker, and return to the Plan step if it is cancelled.
- Link a downloadable CSV template and a one-line format hint.
- Persist the wizard step, or seed it from saved preferences.

### M2 — The progress indicator isn't honest (verified)

- The counter reads "Step 5 of 5" on the Plan step, then "Step 6 of 6" on the Schedule step
  (`useOnboardingWizard.ts:283-286`).
- The AI path opens a separate dialog with its own three steps, so the "recommended" path is really
  eight screens, followed by a 1–2 minute wait in a modal that can't be closed
  (`GeneratePlanDialog.tsx:69-71`).

**Fix:**

- Count the steps each path really has, or say "Last step: choose your plan".
- Fold the AI sub-steps into the wizard: the goal and days-per-week questions overlap with the Goal
  step.
- Let generation continue in the background, with a toast when it's ready.

### M3 — What the wizard asks doesn't match what it keeps (code)

- **The Goal step's goal** ("This helps us tailor your experience", `OnboardingWizard.tsx:33`) is never
  saved. It is only used to prefill the AI dialog (`OnboardingWizard.tsx:177`). Template, import and
  skip users give an answer that is thrown away.
- **General `age`** is described as "collected for every user (profile/onboarding)" and feeds the Race
  Predictor's age cohort (`shared/schema/tables.ts:120-124`). It is also the heart-rate model's only
  fallback when no max HR is set. With neither, HR-based training load and the HR zone table are
  withheld altogether (`server/services/trainingLoad/hrModel.ts:49-58`, `:74-78`). The wizard only
  saves age when the _optional_ fuelling profile is complete (`useOnboardingWizard.ts:138-151`).
- **The race date is never asked**, in a HYROX companion. `training_plans.raceDate` exists
  (`tables.ts:347`) but is only reachable from inside the AI dialog. That dialog defaults "This is my
  race date" to on (`useGeneratePlanForm.ts:194`), for an end date the athlete never chose.
- **"Lose weight" on the Goal step** doesn't prefill "Weight goal: Lose" on the Fuelling step, which
  defaults to Maintain (`useOnboardingWizard.ts:55`).

**Fix:**

- Save the goal (to the plan's `goal`, or a user field).
- Ask for age on the Units/profile step.
- Add an optional "Do you have a race booked?" date that anchors plan length for the template and AI
  paths alike.

### M4 — Accessibility (verified with the ARIA snapshot)

- The four radio groups on the Units step and the goal group have **no accessible name**; the
  snapshot shows a bare `radiogroup:`. The visible "Weight" / "Distance" / "Division" / "Gender" labels
  aren't linked (`UnitsStep.tsx:31-32`, `49-50`, `67-69`, `86-88`; `GoalStep.tsx:50`). Add
  `aria-labelledby`.
- The MAF age field's only visible label is its placeholder "Age". Its limits are `min=1 max=120`, but
  validation needs 16–99 (`GoalStep.tsx:97-107` vs `useOnboardingWizard.ts:108`).
- Validation is **toast-only**: "Complete required MAF profile fields" doesn't say which field, and no
  field gets `aria-invalid`. Show errors inline and link them with `aria-describedby`.
- When the step changes, focus stays on Continue, so the new step's title isn't announced. Move focus
  to the step heading.
- Enter doesn't submit a step because none of them is a `<form>`.

### M5 — Privacy notice is hidden during onboarding, then stacks on the first screen (verified)

The privacy notice hides itself while any blocking modal is open (`PrivacyConsentBanner.tsx:39`). The
wizard is one, so the athlete gives weight, height and age, and possibly the MAF category "Recovering
from major illness or surgery, or on regular medication" (`GoalStep.tsx:118-120`), before seeing the
notice.

When the wizard closes, the banner (`z-[60]`, fixed to the bottom) appears alongside the success toast.
It also sits on top of Settings' sticky **Save Settings** bar, which can't be clicked until the banner is
dismissed; Playwright's click was intercepted. How this bears on consent obligations is for the owner to
judge.

**Fix:** a one-line notice with the policy link on the Welcome step; move the Settings save bar above the
banner.

### M6 — The AI coach is never introduced (code)

The server's consent comment says new users enable AI "in Settings/Onboarding"
(`server/middleware/aiConsent.ts:7-10`), but onboarding has no AI step. As a result:

- the post-wizard coach auto-open (`useOnboarding.ts:66-78`) can never fire for a genuinely new user,
  because it requires `aiCoachEnabled`;
- the empty state still says "Ask our AI Coach" (`TimelineEmptyState.tsx:145-147`);
- the only AI-related copy in the wizard is "Coaching Knowledge (RAG)" (`PlanStep.tsx:78-82`), jargon
  about a later Settings feature placed at the key decision point.

**Fix:** a short "Your AI coach" step that explains what it does and what data it sends, with an explicit
toggle. This also resolves C1 at its root. Drop the RAG note from onboarding.

---

## Low

- **L1** — Today can't be chosen as a start date (`ScheduleStep.tsx:23`). The calendar highlights it
  but greys it out.
- **L2** — Every non-CSRF 403 is sent twice (`queryClient.ts:176-181`). Cheap to fix alongside C1.
- **L3** — The Welcome step takes a click and asks nothing (`WelcomeStep.tsx`). It could carry the time
  estimate ("about 2 minutes"), what you get at the end, and the privacy line (M5). The same "Welcome to
  fitai.coach" heading also shows in the empty state behind the modal.
- **L4** — Imperial users type height in centimetres (`FuellingStep.tsx:142`). Units default to kg/km
  without checking the browser locale.
- **L5** — The optional Fuelling step's button reads "Continue" even when the step is blank; "Skip" says
  what actually happens. "Skip for now - I'll log workouts manually" uses a hyphen where an em dash is
  meant (`PlanStep.tsx:90`).
- **L6** — The AI dialog is prefilled with the generic goal label ("Functional fitness"). A HYROX-specific
  prompt would give a better plan, for example the placeholder's own "complete HYROX Open in under
  90 minutes".
- **L7** — Onboarding offers no way to connect Strava or Garmin and no reminder opt-in. These are the
  two actions most likely to bring an athlete back in week one (see the plan below).

---

## Optimizations beyond the bugs

A proposed shape for the first run, keeping everything that already works:

1. **You** (replaces Welcome + Units): units (defaulted from locale), division, gender, age. One save,
   with the privacy line.
2. **Your race**: "Racing HYROX? Pick the date" (optional) plus the goal, which is saved.
3. **Your coach**: the AI explanation with an explicit on/off choice, which makes the AI plan option
   honest (C1, M6).
4. **Your plan**: AI plan (only if AI is on), template (anchored to the race date or next Monday),
   import (with a CSV template), or skip.
5. **Optional extras**, collapsed: fuelling profile, connect Strava or Garmin, today's-session reminder.

After the wizard, replace the one-off success toast with a small **Getting started** checklist on the
Timeline: log your first workout, connect a device, turn on reminders, and try the coach. Show it until
done or dismissed; Settings already has the "Getting Started" card.

---

## What's working well

- **Durable completion:** a server `onboardingCompleted` flag with a localStorage fallback that syncs
  up later (`useOnboarding.ts:44-50`), so the wizard doesn't reappear on a second device.
- **Accidental-dismiss guards:** backdrop clicks are blocked, and the athlete can't leave with an
  unscheduled template plan (`useOnboardingWizard.ts:231-240`).
- **The Fuelling step:** it previews targets live from the entered profile, reuses the MAF age, and
  never blocks onboarding when it fails.
- **The MAF question:** it asks Maffetone's categories directly (audit M6 in
  [CALCULATION_AUDIT_2026-08-20.md](CALCULATION_AUDIT_2026-08-20.md)), and the server validates the MAF
  profile on the way in.
- **Re-entry and progress:** a re-entry point in Settings (`?onboarding=run`), a screen-reader-only
  `<progress>`, and a step count announced in the title.
- **Save latency:** 160–180 ms per step locally, so the step-by-step saves don't feel slow.

---

## Test coverage gaps

These gaps are why the Critical findings shipped with a green suite:

- `client/src/components/OnboardingWizard.test.tsx:52-80` mocks `GeneratePlanDialog`, so no unit test
  ever sends a generation request.
- `cypress/e2e/onboarding.cy.ts:9-11` stubs `PATCH /api/v1/preferences` to `200 {ok:true}`, so the
  varchar overflow can't happen in E2E. The spec also never clicks Generate or finishes the template
  path.
- The server route tests mock storage (`server/routes/__tests__/preferences.test.ts`), so column limits
  are never exercised.

**Suggested additions:**

1. An integration test (`vitest.integration.config.ts`, real Postgres) that PATCHes every preference
   enum value.
2. An E2E test that walks the template path with the real API and asserts no **Missed** badge exists on
   first view.
3. A unit test that the generate action opens the consent gate when `aiCoachEnabled` is false.
4. A 375 px overflow assertion on each wizard step.

---

## Suggested fix order

| Order | Items         | Why this order                                                                                                                                             |
| ----- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | C2 + H2       | The migration is one line, but it must not ship before H2's prefilled wizard: land H2 first or in the same release, or fixing C2 makes H2's overwrite live |
| 2     | C1            | Reuse `useAiConsentGate`; humanize the error; stop the duplicate 403                                                                                       |
| 3     | C3, L1        | A default-start or scheduling change. Decide first whether it applies to onboarding only or everywhere                                                     |
| 4     | H1, H3, H4    | Small, local UI fixes                                                                                                                                      |
| 5     | M1–M6         | Flow and consent changes; the M4 accessibility fixes are small and can ride along earlier                                                                  |
| 6     | Optimizations | Reshape the flow once the bugs are gone                                                                                                                    |

---

## Reproducing

Run the app with the dev auth bypass: no Clerk keys, `ALLOW_DEV_AUTH_BYPASS=true`, `NODE_ENV=development`,
and a local Postgres. Before each run, execute `DELETE FROM users WHERE id = 'dev-user'`; the server
recreates the user as a brand-new account on the next request. Then:

- **C1:** walk to the Plan step → Generate AI Plan → Next → Next → Generate Plan.
- **C2:** Get Started → Continue with no changes, then look at the server log. Or open Settings, change
  any value and click Save.
- **C3:** on any day from Tuesday to Saturday, pick the template → Start Training.
- **H1:** set the viewport to 375 px wide and open the Plan step.
