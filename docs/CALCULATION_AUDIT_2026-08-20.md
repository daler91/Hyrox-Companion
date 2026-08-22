# Calculation Correctness Audit — 2026-08-20

**Method.** A targeted audit of every place the app computes a number or applies a rule-based
decision: pace/split/time math, training load, progression rules, 1RM and intensity estimates,
heart-rate zones, calorie and macro math, streaks, PRs, trends, and anything that ranks, scores,
filters or selects a workout — including aggregations done in SQL/Drizzle rather than in
application code. Two multi-agent fleets (31 agents total) inventoried 12 domains; 225 candidate
findings were then put through an adversarial verifier instructed to _refute_ each one against the
source (**190 confirmed, 34 rescoped, 1 undetermined**). Findings marked `EXECUTED` below were
additionally reproduced by hand: importing the shipping module and running it against a constructed
athlete. Every claim was read in the implementation — never inferred from a name, comment, JSDoc,
type, or test title. Where a comment and the code disagreed, the code won and the disagreement
became part of the finding.

**Snapshot.** HEAD `144ea7e`, branch `claude/fitness-calc-audit-h1u7p2`. ~182k lines of TS/TSX
across client (670 files), server (416), shared (55). 71 findings: 7 critical, 21 high, 27 medium,
16 low. **Zero produce a crash** — every one renders a plausible, confident, wrong number to the
athlete.

**Framing.** Wrong numbers here do not throw. A crash gets reported by a user; a wrong number gets
acted on. Findings are therefore ranked by how _quietly_ wrong they are and how default the code
path is, not by how dramatic the failure looks.

---

## Remediation status (updated 2026-08-22)

**Phase 0 — characterisation tests.** Landed. `test/audit/` pins the behaviour of every C-tier
finding, with a header on each test naming the finding ID, the current value, the intended value,
and how to retire it. See [`test/audit/README.md`](../test/audit/README.md). The tests are green,
not red: a knowingly-red suite would break the repo's gates and train people to ignore it, so
characterisation tests assert what the code does now (and turn red when a fix lands), while
`it.fails()` intent tests state the invariant and turn red with "expected to fail, but passed".

**Phase 2 — safety guards.** Landed for C1, C2, C3, C5, M9 and L8.

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `computeMonotonyStrain` separates the two SD = 0 cases and computes variance two-pass. Uniform load reports at `MONOTONY_CEILING` (10) and classifies `high_risk`; only a week with no load at all is null. `TrainingMonotonyZone` gained an `"unknown"` member so an absent measurement can never be styled or reasoned about as a healthy one.                        |
| C2  | The `age >= 65` branch no longer sits above the consistency/trend checks and no longer applies −5. The athlete keeps the category they earned (65 → 120 bpm, was 110) and 65+ adds a clinician-check warning. Maffetone's upward allowance is discretionary in the source, so it is surfaced rather than auto-applied.                                                  |
| C3  | `day.tsb` moved below the `ratioFrom` gate, so Form is withheld for the same first 14 days as ACWR. That alone was **not** enough — an athlete whose single workout is 20 days old is past the gate — so `computeRaceReadiness` now also takes acute load and returns `insufficient_data` below `MIN_ACUTE_UTSS_FOR_FORM`. A real taper still reads "peaked".           |
| C5  | `effectiveTargetWindowed` bounds how far the carb delta may go negative so the load-scaled target cannot fall below `ABSOLUTE_CALORIE_FLOOR`, and emits `effective_calorie_floor_applied`. Bounding carbs rather than raising `calories` keeps calories and macros reconciled. The inverted `carbs_floored` condition noted in the register is fixed in the same block. |
| M9  | Monotony gained its own 7-day history gate (`MONOTONY_WINDOW_DAYS`), separate from ACWR's 14. Tying it to ACWR's window was too strict — monotony needs 7 days, not 14.                                                                                                                                                                                                 |
| L8  | `hrZoneBoundaries` mirrors the `hrMax <= hrRest` guard `hrReserveRatio` already had, returning no table rather than an inverted one.                                                                                                                                                                                                                                    |

Existing tests that asserted the buggy values were **inverted, not preserved**:
`trainingLoadService.test.ts` (uniform-load monotony null → 10, `monotonyZone(null)` "ok" →
"unknown") and `shared/maf.test.ts` (the age-65 −5 assertion). This is the case Phase 0 exists to
make visible.

**Still open in Phase 2:** M6 and L9. Both need a product decision rather than a code fix — M6
requires collecting Maffetone's actual categories (2+ years injury-free, colds/flu, allergies) in
onboarding instead of a bare "Low/Moderate/High", and L9's under-16 handling is entangled with the
same screen and with the 16–99 validation that currently makes the branch unreachable.

**Phase 1 — units.** Landed for C7, H1, H2, H16, M8 and L6, with
[`docs/adr-units.md`](adr-units.md) as the durable contract and `shared/units.ts` as the mechanism.

| #   | Fix                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C7  | `resolveStructureStepTimeTarget` stopped coalescing `targetTime`/`time` (minutes) with `durationSeconds` (seconds) into one verbatim number. Seconds now convert at the boundary, so a 45-second transition stores 0.75 min rather than 45 min.                                                                        |
| H1  | `mafTestService` converts `workout_logs.duration` (minutes) to canonical seconds before it reaches `MafTestMetrics.durationSeconds`. Auto-pulled MAF pace was 60× too fast; a 10 km hour-long run read 0:06/km.                                                                                                        |
| H2  | `WeeklyReviewHighlights` renders `bestTime` through `formatMinutes` instead of `formatSecondsToMmSs` (a 12-minute best showed "0:12"), and takes the athlete's weight and distance preference instead of hardcoding "kg"/"m".                                                                                          |
| H16 | `serializeWorkoutStructure` now **requires** the distance preference. It appended "m" unconditionally while a miles athlete's rows store feet, so a 400 m carry rendered "1312m". Same fix applied to the CSV export header, the AI personal-record summaries, and the Gemini stat lines.                             |
| M8  | `computeProgressionFlags` requires the athlete's weight unit. It interpolated "kg" over a pounds athlete's loads, reaching the coaching model inflated 2.2×.                                                                                                                                                          |
| L6  | `METRES_PER_MILE` is defined once in `shared/units.ts`; `unitConversion.ts` derives `KM_TO_MILES` from it rather than carrying a second literal that disagreed by 2.5 ppm.                                                                                                                                            |

Three contracts that advertised the wrong unit were corrected alongside: the set-level zod bound
(`max(86_400)` — seconds in a day — became `SET_TIME_MAX_MINUTES`, since the old bound permitted a
60-day set and so could never catch a seconds value in a minutes field), the OpenAPI examples
(`{ distance: 1000, time: 210 }` advertised seconds to every API consumer), and the `exercise_sets`
column comments, which now state that `weight` and `distance` are **not** canonical.

`workoutService.test.ts`, `structure.test.ts`, `mafTestService.test.ts` and `exportService.test.ts`
all contained assertions certifying these bugs and were **inverted**. The MAF fixtures were
seconds-shaped (`duration: 1800` — 30 hours in a minutes column) precisely because the code never
converted; correcting the input left every expected output unchanged.

**Still open in Phase 1:** L4 and L1. L4 (canonicalise stored weights, or warn at the preference
toggle) is a product call about existing athletes' data and is recorded as explicitly undecided in
the ADR. L1 (advice that changes with display units) follows from the same undecided question.

**Not yet started:** Phases 3, 4, 5, 6, and C4, C6 — note C4 (the age-cohort fallback) is
not covered by any of the six root causes below and needs its own fix.

---

## How to read this

Every finding carries a **verification tier**:

| Tier       | Meaning                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `EXECUTED` | The shipping module was imported and run; the output below is what it returned.                                                    |
| `READ`     | The exact lines and data path were traced by hand. Confident, not executed.                                                        |
| `REPORTED` | Surfaced by an audit agent and passed adversarial verification, but **not** re-derived by hand. A strong lead, not a settled fact. |

And a **label**: **provably wrong** (the code contradicts its own cited source, its own comment, or
arithmetic) or **questionable design choice** (the code does what it intends, and the intent is the
problem).

### What is genuinely sound

This is a carefully built codebase and most of it survives scrutiny. Recording it so the register
below is not mistaken for a verdict on the whole system:

- **Mifflin–St Jeor** is exact to the term (`nutritionTargets.ts:64`). 80 kg / 180 cm / 30 y male → 1780.
- **Tanaka** (`208 − 0.7 × age`) is exact and is the better choice over `220 − age` (`trainingLoadService.ts:369`).
- **Karvonen** uses genuine heart-rate _reserve_, not %HRmax (`trainingLoadService.ts:391`). Zone floors `0/.6/.7/.8/.9` have no gaps or overlaps.
- **Epley** is exact and correctly bounded to 2–10 reps, with `r=1` deliberately excluded (`analyticsService.ts:45`).
- **TSS / hrTSS** match `hours × IF² × 100` (`trainingLoadService.ts:494`).
- **ACWR** is a correct Williams-style EWMA (`λ = 2/(N+1)`), seeded at first log and gated behind 14 days.
- **Unit conversion constants** are correct to 6–7 figures (`unitConversion.ts:51-55`).
- **Streak counting** is timezone- and DST-correct (`routeUtils.ts:112`) — it uses `getLocalDateStr` and walks calendar-date strings.
- **Nutrition** scales per-100g through exactly one function (`rollup.ts:28`), and `energyBalance.ts:74` refuses to return a number when the profile can't support an honest BMR.
- **The race benchmark dataset** is derived from 34,000+ real results and its age curve is physiologically shaped (peak at 30–34, monotonic decline after).

The problems below sit in the layers _above_ those primitives — in the guards, the windows, the
fallbacks, the denominators, and the rules.

---

## The seven critical findings

### C1 — The overtraining detector goes silent for the most overtrained athlete

`server/services/trainingLoadService.ts:663`, `:630-634`, `:1049` · **EXECUTED** · provably wrong

`computeMonotonyStrain` guards its divide-by-zero with `if (sd === 0) return { monotony: null,
strain: null }`. Two opposite situations produce `sd = 0`: a week of no training (mean 0, genuinely
undefined) and a week of _perfectly identical daily load_ — which is unbounded monotony and the
single strongest pattern Foster's metric exists to flag. Both collapse to `null`, and
`monotonyZone(null)` returns `"ok"`.

```
calculateTrainingLoad() — identical 60-min session every day, 12 weeks
  last-7 utss  [9.9, 9.9, 9.9, 9.9, 9.9, 9.9, 9.9]
  monotony=null  strain=null  zone=ok  acwr=1.0 sweet_spot

Control — realistically varied week, same engine:
  [9.9, 6, 11.9, 2, 8.9, 10.9, 6.9] → monotony=2.57 high_risk  ✓
```

`finalizeDailyLoad` rounds UTSS to one decimal (`:1049`), so any athlete repeating the same session
produces byte-identical daily values. This is the common case, not an exotic one.

**The same expression fails a second way.** `variance = sumSq/n − mean²` is the numerically unstable
one-pass form. For seven _identical_ values it cancels to exactly 0 at most magnitudes — the null
path above — but at some it leaves a residue:

```
utss/day     sd            monotony          zone
    9.9      0             null              ok (null guard)
   93.6      0             null              ok (null guard)
   94.8      1.3487e-06    70,289,952.98     high_risk
  112.8      1.3487e-06    83,636,146.58     high_risk
```

94.8 UTSS/day is a 60-minute session at RPE 7. Identical input, two different absurd answers,
selected by a float bit pattern. Strain reaches 46,644,412,797.5 against a risk threshold of 2.0.

**Blast radius.** `null` → zone `"ok"` silences every safety surface at once: `formatMonotony(null)`
renders `"N/A"` in neutral `text-foreground` (`AcwrTrendChart.tsx:51`); `FormMonotonyTrendCharts.tsx:28`
filters on `monotony != null` so the trend line disappears; zone `sweet_spot` emits no governor
restriction; and the AI coach's "vary intensity and protect a true rest day" instruction is gated on
`monotonyZone === "elevated" || "high_risk"` (`prompts.ts:94`) and never fires.

**Correct behaviour.** Separate the two zero-SD cases. When `mean > 0 && sd === 0`, monotony is
unbounded: return a capped sentinel and classify `high_risk`. Reserve `null` for `mean === 0`, and
make `monotonyZone(null)` return an explicit "unknown" that is not styled as safe. Use a two-pass
variance so near-identical weeks don't land in the same trap.

---

### C2 — An athlete's aerobic ceiling falls 11 bpm on their 65th birthday

`shared/maf.ts:33-39` · **EXECUTED** · provably wrong

`else if (input.age >= 65) adjustment = -5` sits _above_ the consistency/trend branch, pre-empting
the +5 a well-trained athlete would otherwise earn. Its comment cites Maffetone. Maffetone's
published 180-Formula has no −5 for age; his stated exception runs the other way — for athletes 65
and over in category (d), _up to 10 beats may have to be added_.

```
calculateMafHr({ injuryIllnessMedication: false, consistency: "high", trend: "improving" })
  age 63 → base 117  adj +5  ceiling 122
  age 64 → base 116  adj +5  ceiling 121
  age 65 → base 115  adj −5  ceiling 110   ← one birthday, −11 bpm
  age 70 → base 110  adj −5  ceiling 105

Maffetone for the same athlete: 115 + 5 = 120, plus the 65+ exception of up to +10 → 120–130.
```

The comment names the behaviour it is suppressing: _"otherwise a healthy 65-year-old falls through
to the consistency/trend branch and can be handed +5."_ That +5 is the correct answer under the
cited source. For a trained 68-year-old, 110 bpm is close to walking pace, and that ceiling then
drives `computeMafCompliance`, so genuinely aerobic runs score `over_ceiling` and the athlete is
repeatedly told to slow down.

---

### C3 — Train once, disappear for three weeks, and the app calls you race-ready

`server/services/trainingLoadService.ts:714-727`, `racePredictionService.ts:98-115` · **EXECUTED** · provably wrong

ACWR is correctly withheld until 14 days of history (`ratioFrom`). TSB is not: `day.tsb` is assigned
at `:725`, _before_ that gate at `:727`. `computeRaceReadiness`'s only guard is `tsb == null`.

```
One workout, 20 days ago, nothing since:
  acute=0.4  chronic=27.0  →  tsb = +26.7
  acwr=0.01  zone=undertraining          (ACWR correctly cautious)

  computeRaceReadiness(26.7) → 27 ≥ 15 → status "peaked"
  "You're well-rested and sharp — ideal for race day."
```

Chronic EWMA (λ ≈ 0.069) decays far slower than acute (λ = 0.25), so after any layoff acute
collapses while chronic lingers. TSB structurally cannot tell _tapered_ from _detrained_. The two
signals on the same screen contradict each other, and the worse the detraining, the more confident
the advice.

---

### C4 — Aging out of the benchmark table makes the race predictor think you got faster

`shared/raceSpec.ts:268-289`, `raceConstants.ts:200-207` · **EXECUTED** · provably wrong

`deriveAgeGroupFromAge` produces bands up to `80-84`, but the generated dataset only contains
cohorts up to `60-64` (open male; pro runs out earlier). On a miss, the code falls back to
`getRaceReference(div, gender)` — the **all-ages roll-up**, dominated by 25–39-year-olds.

```
RACE_BENCHMARKS, open|male — summed median total (stations + runs + roxzone)
  16-24  n=1969  84:49       50-54  n=1930  90:45
  25-29  n=5090  84:42       55-59  n= 996  94:50
  30-34  n=7878  84:39       60-64  n= 345  96:08
  35-39  n=7261  85:33       65-69    —     (no cohort)
  40-44  n=5492  86:52       all-ages n=34232  86:21

  aged 62 → band "60-64" exists  → predicted 96:08
  aged 67 → band "65-69" missing → predicted 86:21   ← 9:47 FASTER
```

The underlying data is good; only the miss-handling is wrong. Clamp to the _nearest available_ band
rather than to all-ages.

---

### C5 — Periodisation silently breaches the app's own calorie safety floor

`shared/nutritionTargets.ts:431-446` (floor enforced only at `:116-121`) · **EXECUTED** · provably wrong

```
55 kg female, 162 cm, 34 y, light activity, lose 0.25 kg/week
  baseline           1418 kcal   (floor not triggered — correct)
  rest day           1158 kcal   ← BELOW the 1200 kcal floor
  light session      1236 kcal
  typical session    1314 kcal
  reasonCodes on the effective target: []
```

The floor lives in `calculateNutritionTarget` and is never re-checked in `effectiveTargetWindowed`.
No warning, no reason code — for exactly the demographic the floor exists to protect.

---

### C6 — Every athlete gets a hardcoded training-load reference of 50 UTSS

`client/src/pages/nutrition/TargetsDialog.tsx:86`, `shared/nutritionTargets.ts:517` · **EXECUTED** · provably wrong

The only call site is `defaultPeriodizationConfig(parsed.carbG ?? 0, 0)` — the second argument is
`recentAvgDailyUtss`, hardcoded to zero. So `rawReference = 0 > 0 ? … : 50` always yields **50**,
and the function's docstring ("derived from … the athlete's typical daily load", "the reference is
floored at MIN_REFERENCE_UTSS so a near-zero recent average can't blow up the slope") is false for
every user.

```
athlete's real typical UTSS   documented ref    actually used
                       15              25              50
                      120             120              50

70 kg athlete, baseline 2540 kcal / 351.5 g carbs; ref=50, slope=3.5 g/UTSS
  rest day                      carbs 176.5 g (−175)   calories 1840
  typical session (UTSS 30)     carbs 281.5 g (−70)    calories 2260
  at the assumed reference (50) carbs 351.5 g (+0)     calories 2540
```

A real logged session in this model measures ~10–30 UTSS, so most athletes are told to **cut carbs
on days they actually trained**. `maxCarbDeltaG` caps the positive delta; nothing floors the negative one.

---

### C7 — A 60× unit error on a live editing path

`server/services/workoutService/structure.ts:90`, `WorkoutStructureEditor.tsx:542` · **EXECUTED** · provably wrong

The structure editor's Time field is labelled `"Sec"` with `aria-label="… duration in seconds"`.
`configToStructureBlocks.ts:15` writes it to `targets.durationSeconds`;
`resolveStructureStepTimeTarget` returns it verbatim; `derivedSetRowFromStep` writes it into
`exercise_sets.time`.

`exercise_sets.time` is **minutes**: `plannedSessionEstimate.ts:258` reads it as "wall-clock
minutes" and `workoutStructureSummary.ts:10` renders `` `${set.time}min` ``. A 45-second transition
becomes 45 minutes of planned session. `workoutService.test.ts:313` asserts the passthrough — a test
baking in the bug.

---

## Findings register

Grouped by severity. `#` keys are stable for cross-referencing from code comments and PRs.

### High

| #   | Location                                                        | Tier     | What is wrong                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | `mafTestService.ts:130`                                         | EXECUTED | **Second 60× error.** `durationSeconds: workout.duration` writes `workout_logs.duration` — documented "Session length in MINUTES" (`tables.ts:352`) — into a field documented as canonical seconds (`maf.ts:140`). A 10 km MAF run in 60 min renders as **0:06/km** instead of 6:00/km. The MAF trend's whole purpose is broken.                                                                                                              |
| H2  | `WeeklyReviewHighlights.tsx:23`                                 | READ     | **Third 60× error.** A `bestTime` PR (value = `exercise_sets.time`, minutes) is passed to `formatSecondsToMmSs`. A 12-minute best renders as `"0:12"`. The same line hardcodes `" m"` and `" kg"`, ignoring unit preference.                                                                                                                                                                                                                  |
| H3  | `trainingLoadService.ts:362-378` + `useOnboardingWizard.ts:163` | EXECUTED | Missing `age` silently substitutes HRmax 190 / rest 60. A 52-year-old's threshold run reports as **easy aerobic Z2** (69.2% HRR vs the true 82.3%). `users.age` is only ever _written_ by the **optional** nutrition onboarding step, so skipping a nutrition screen corrupts heart-rate zones.                                                                                                                                               |
| H4  | `analyticsService.ts:69-73, 87-97`                              | EXECUTED | Isometric holds outside a 4-item allowlist invert: 30s→60s records no PR, and a later 20s **regression** is celebrated as a new best. Direction keys on `exerciseName` while PRs bucket on `custom:label`, so **every custom-labelled exercise is affected — including a plank**.                                                                                                                                                             |
| H5  | `nextTarget.ts:57-91`                                           | EXECUTED | Progression has no cap, no deload, no failure path. Across 1,800 inputs: **1,775 increases, 0 decreases, 0 holds**. Applied to its own output from 3×5 @ 100 kg it reaches **165 kg in 26 sessions** (e1RM 116.7 → 192.5). `plannedReps`/`plannedWeight` _are_ populated on the same row (`storage/shared.ts:33`), so it could tell whether the athlete hit the prescription and does not look.                                               |
| H6  | `emailScheduler.ts:84` + `storage/analytics.ts:235-265`         | READ     | Weekly email completion rate divides _logged workouts_ by _logged workouts + missed + skipped plan days_ — two different tables. An athlete with **no plan** is emailed "100%", captioned "3 of 3 planned sessions". The storage layer's own comment at `:93-95` warns against exactly this.                                                                                                                                                  |
| H7  | `analyticsService.ts:481` + `:244-283`                          | READ     | "Avg / Week" divides by `weeklySummaries.length`, and the week map only creates entries for weeks that _contain_ a workout. **Rest weeks are structurally invisible.** Train 3× in week 1, rest three weeks, train 3× in week 5 → "3.0 / week" instead of 1.2. It can never fall below 1.0.                                                                                                                                                   |
| H8  | `analyticsService.ts:482` + `:259`                              | READ     | "Avg Duration" sums duration only `if (log.duration)` but divides by _every_ logged workout. Ten workouts, five with 60 min recorded → **30 min average** instead of 60. Also treats `duration = 0` as missing.                                                                                                                                                                                                                               |
| H9  | `analyticsService.ts:490-498`                                   | READ     | "Avg RPE" is an unweighted mean of _weekly_ means — a 1-workout week weighs as much as a 6-workout week. Average compliance (`ai/index.ts:200-210`) has the identical shape, and its `windowDays: 70` is asserted rather than enforced.                                                                                                                                                                                                       |
| H10 | `analyticsService.ts:557-567`                                   | REPORTED | "Avg Adherence" is computed only over sessions the athlete actually **logged**, so skipping most of the plan raises adherence toward 100%. It is additionally a mean of per-session ratios rather than a pooled ratio.                                                                                                                                                                                                                        |
| H11 | `analyticsService.ts:552` + `ai/coachingInsights.ts:99`         | READ     | "This week" is **UTC** in analytics and the coach but **athlete-local** in the weekly review. A UTC−8 athlete's weekly count resets Sunday afternoon. Weekly-volume trend also compares a _partial_ current week against a _complete_ previous one, so Monday always reads "decreasing".                                                                                                                                                      |
| H12 | `racePrediction/featureBuilder.ts:279`                          | READ     | `projectedSplitSeconds` guards `null` and non-finite `time` but **not `time <= 0`**. The schema explicitly permits 0. One set saved with time 0 yields a 0-second station split feeding the median/best.                                                                                                                                                                                                                                      |
| H13 | `ai/index.ts:387-391` + `trainingDecisionEngine.ts:76-108`      | READ     | **The decision engine's safety gates are fed hardcoded literals.** `raceContext: { hasRace: false, daysToRace: null }` makes `raceWeek`/`raceSoon` permanently false — every race-proximity protection is unreachable, though `training_plans.raceDate` exists and is populated. `sleepQuality: "ok"` and `restingHrDelta: 0` are literals too, and `soreness` is only ever "high"/"low", so the `=== "medium"` soft-recovery branch is dead. |
| H14 | `shared/energyBalance.ts:96-120`                                | EXECUTED | The estimated path attributes **more** activity to a rest day than the measured path does to a real session. 80 kg athlete, 2500 kcal: rest day, no sync → 1602 kcal "activity", −882 balance; same day with a real 600 kcal session synced → 600 kcal, −236. A **646 kcal swing driven only by whether Strava synced**. Labelled "estimated", which is the only thing keeping it out of critical.                                            |
| H15 | `planPhase.ts:57, 74-79` + `storage/plans.ts:393-416`           | READ     | `computeCurrentWeek` clamps with `Math.min(week, totalWeeks)` and `computePlanPhase` maps `currentWeek >= totalWeeks` to `race_week`. A plan that ended months ago is still selected ("most recently ended") and reports **race week forever**, locking the coach into "reduce work only". Measuring progress at week _end_ also means a 4-week plan starts in BUILD and a 3-week plan PEAKS in week 2.                                       |
| H16 | `workoutStructureSummary.ts:9` + `unitConversion.ts:119`        | READ     | `getStoredDistanceUnit` stores **feet** for miles-preference athletes, but the summary appends `"m"` unconditionally. A 400 m carry stored as 1312 ft renders **"1312m"** — a 3.28× overstatement under the wrong unit label.                                                                                                                                                                                                                 |
| H17 | `planGenerationService.ts` (chunking)                           | REPORTED | Plan chunks are generated by **parallel model calls with no shared state**, so the "increase 2.5–5% per week" instruction cannot be enforced across a chunk boundary and is never verified afterwards. Progressive overload is unverifiable by construction.                                                                                                                                                                                  |
| H18 | plan day focus handling                                         | REPORTED | A `"rest"` **substring** in a plan day's focus label silently **deletes that day's entire structured exercise table**. "Active rest + mobility" loses its prescription.                                                                                                                                                                                                                                                                       |
| H19 | `trainingLoadService.ts:1035-1044`, `:975-989`                  | REPORTED | All four injury-vector restrictions are inert for Strava/Garmin-imported and free-text workouts — every vector stays exactly 0, so the governor never fires for imported sessions.                                                                                                                                                                                                                                                            |
| H20 | `trainingLoadService.ts:963-973`                                | REPORTED | UTSS for the same session differs by ~2× depending only on whether the athlete typed their sets in, because `sets.length === 0` opens the duration-based cardio branch.                                                                                                                                                                                                                                                                       |
| H21 | `trainingLoadService.ts:714-718`, `:946-951`                    | REPORTED | EWMAs seed from the first log _inside the caller's fetch window_, so ACWR and TSB depend on the lookback and disagree across surfaces (−70d, 90d, −7d) by up to 12 TSB points.                                                                                                                                                                                                                                                                |

### Medium

| #   | Location                                                                | Tier     | What is wrong                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `trainingLoadGovernor.ts:29`                                            | EXECUTED | Missing group parentheses make four of six alternatives unanchored substrings. `"uphill sled push"` classifies as a **running workout** via "hill" inside "uphill". A strength note reading "tempo, threshold effort" trips all three classifiers at once.                                                                               |
| M2  | `trainingLoadService.ts:340`                                            | EXECUTED | Every unweighted rep is valued at exactly **20 kg** of tonnage — a burpee, a pull-up and a wall ball are identical load. Uncited, and it dominates UTSS for Hyrox-style sessions. `users.bodyweightKg` never reaches the load model.                                                                                                     |
| M3  | `ai/index.ts:198`                                                       | READ     | `prsThisWeek` spans **8 days** (`today-7 … today`, inclusive both ends) and disagrees with the email's calendar-week count of the same metric.                                                                                                                                                                                           |
| M4  | `sessionEstimate/runPace.ts:24, 66` + `plannedSessionEstimate.ts:79-87` | READ     | The pace ratio clamps to 4:36–7:11/km, and runs slower than 9:16/km are discarded as mis-tagged. A beginner running 9:30/km has _every_ run thrown away, falls back to a generic 5:45/km, and **more data never fixes it**.                                                                                                              |
| M5  | `statsUtils.ts:50-62` + `CoachPanelStats.tsx:25`                        | READ     | An _all-time_ completion rate is shown as "Rate" among weekly stats, and **today's not-yet-done session already counts against it**. Excused absence days count as failures too.                                                                                                                                                         |
| M6  | `shared/maf.ts:30-48` + `GoalStep.tsx:116-134`                          | EXECUTED | The +5 elite adjustment goes to anyone picking "High" + "Improving" with **no check of training-history length**; Maffetone reserves it for 2+ injury-free years. One switch collapses his −10 and −5 categories, so hay fever costs 10 bpm. The dropdowns say only "Low/Moderate/High".                                                 |
| M7  | `prompts.ts:374, 377`                                                   | READ     | The compounding rule exists — as _prompt prose_: "BUILD (25–60%): **Increase weights 2.5–5% per week**" and "Include a DELOAD week at ~50% of plan". Nothing in code enforces either. At 5%/week: **1.48× over an 8-week build block, 3.56× over 26 weeks** (100 kg squat → 356 kg).                                                     |
| M8  | `ai/coachingInsights.ts:160-166`                                        | READ     | Progression flags interpolate a hardcoded `kg` suffix into the coaching prompt while weights are stored in the athlete's display unit — a pound-user's loads reach the model **inflated 2.2×**. Progression is also detected by comparing only the first and last of three sessions.                                                     |
| M9  | `trainingLoadService.ts:655, 700`                                       | EXECUTED | Monotony and strain are computed for brand-new athletes from days that predate their history, treated as rest. One workout ever → monotony 0.41, strain 4.8. ACWR correctly withholds; monotony does not.                                                                                                                                |
| M10 | `analyticsService.ts:247-283` + `WeeklyWorkoutsChart.tsx:72`            | READ     | The same missing-week map behind H7 also **deletes zero-training weeks from the weekly bar chart**. A layoff renders as if it never happened, and the chart mislabels how many weeks it shows.                                                                                                                                           |
| M11 | `storage/nutrition.ts:882-929` + `tables.ts:1319-1323`                  | READ     | Logged nutrition is computed by joining live to `foods` and is _never snapshotted_ — deliberate and safe for immutable USDA rows, but recipes and custom foods **are** user-editable, so editing one silently rewrites **already-logged past days**.                                                                                     |
| M12 | `storage/workouts.ts:99-114`                                            | READ     | `countPrSets` tests `s.weight >= max`, and `maxByExercise` is built from all the athlete's sets **including this workout's own**. The set is compared against a maximum it is inside: it always counts itself, and equalling an old best also counts. (`analyticsService.updateMaxWeight` uses strict `>` — two PR paths that disagree.) |
| M13 | `exercise-table/lastSession.ts:22-40`                                   | REPORTED | `pickLastSession` filters on date only, not on workout log, so **two separate sessions on the same day are merged** — doubling the volume "Last time" shows and "Next" progresses from.                                                                                                                                                  |
| M14 | `storage/mafTests.ts:160-175`                                           | REPORTED | MAF test count and both trend charts are **silently truncated at 20 rows**, and `complianceTrend` compares the newest test against the oldest row still inside that window, so the baseline slides forward as the athlete logs more.                                                                                                     |
| M15 | `shared/plannedSessionEstimate.ts:307-322`                              | REPORTED | The estimate **discards every per-set time as soon as any block carries its own timing**, so a session with a timed warm-up is estimated at the warm-up's length. Hard-clamped to 10–180 min with no flag when a bound is hit.                                                                                                           |
| M16 | `stravaMapper.ts:53-60`                                                 | REPORTED | Strava kilojoules → kcal via the thermodynamic factor **0.239**. Strava's kJ is _mechanical work_, not metabolic energy; at ~24% gross efficiency the conventional conversion is ≈1 kJ ≈ 1 kcal. Understates expenditure ~4×.                                                                                                            |
| M17 | `nutritionTargets.ts:311-322, 374`                                      | REPORTED | **Race-week and taper carb-loading actually cut carbs.** The taper damp applies only when the base-load delta is positive, so on a low-load taper day the negative delta passes through undamped and swamps the race-week bonus.                                                                                                         |
| M18 | `nutrition/labelParser.ts:50`                                           | REPORTED | Label energy unit parsed as `z.enum(["kcal","kJ"]).catch("kcal")`, so a model spelling it `"kj"` silently degrades to kcal — a **4.184× overstatement** the plausibility clamp does not catch.                                                                                                                                           |
| M19 | `nutrition/offClient.ts:114`                                            | REPORTED | Open Food Facts has no kJ→kcal path: a kJ-only product caches with `calories = null` and logs as **0 kcal**, while the acceptance gate explicitly admits products with no kcal value.                                                                                                                                                    |
| M20 | `nutrition/offClient.ts:63-65`                                          | REPORTED | OFF `serving_quantity` is used as grams with no unit check, so millilitre servings are stored as gram quantities.                                                                                                                                                                                                                        |
| M21 | `storage/nutrition.ts:273, 834-851`                                     | REPORTED | Recipes write their backing food with `micros = NULL`, discarding all micronutrients; and `upsertFoods` overwrites a food's micros with the incoming sparse set, wiping USDA enrichment on the next search.                                                                                                                              |
| M22 | `LogFoodDialog.tsx:80-92`, `MealSection.tsx:47-57`                      | REPORTED | Edit-mode preview rescales already-rounded stored values, so the number shown before saving differs from what is stored; per-meal totals sum rounded entries, so meal cards never reconcile with the day header.                                                                                                                         |
| M23 | `trainingLoadGovernor.ts:346-375`                                       | REPORTED | Governor severity inversion: passes share `usedWorkoutIds` and run vector rules first, so a lower-severity restriction can claim a workout and block the ACWR danger lock.                                                                                                                                                               |
| M24 | `trainingLoadGovernor.ts:70-101`                                        | REPORTED | The "recovery run" downshift copies the original distance **and** time, prescribing the same pace it was meant to slow down. It can also convert a pure strength day into a single blank `recovery_run` row.                                                                                                                             |
| M25 | `trainingLoadService.ts:314-317` vs `:529`                              | REPORTED | Two unreconciled RPE→load curves. The strength curve `1.18^max(0, rpe−6)` is flat for every RPE ≤ 6, so a deload is invisible to the load model.                                                                                                                                                                                         |
| M26 | `trainingLoadService.ts:658-665`                                        | REPORTED | Monotony uses population SD (÷n) against Foster's published >2.0 threshold, which assumes sample SD — inflating monotony by `sqrt(7/6)` = **8.0%**.                                                                                                                                                                                      |
| M27 | `overviewAnalysisService.ts:60`                                         | REPORTED | The AI system prompt tells the model UTSS is RPE-based and should broadly agree with hrTSS. Both claims are false — HR is the first branch of UTSS, and the scales diverge up to 2.5×.                                                                                                                                                   |

### Low

| #   | Location                                                       | Tier     | What is wrong                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `nextTarget.ts:25, 70-84`                                      | EXECUTED | Advice depends on display units. 85 kg → "+1 rep"; the identical 187 lb → "+5 lb". Crossover is 87.5 kg metric, 79 kg imperial.                                                                                                                                             |
| L2  | `nextTarget.ts:73, 84`                                         | EXECUTED | Gain is computed as a difference of two Epley products, drifting 2.7e−15 high, so at exactly 25.0 kg the suppression threshold flips on float representation alone.                                                                                                         |
| L3  | `nextTarget.ts:68, 84`                                         | EXECUTED | At 3×10 with anything under 25 kg — the beginner dumbbell case — the function returns **nothing at all, permanently**. Any set with varying reps (10/9/8) also yields nothing.                                                                                              |
| L4  | `unitConversion.ts:19-34`                                      | READ     | Stored weights carry no unit column. Switching kg↔lb reinterprets all history as a ~2.2× jump. Documented and accepted in the S5 sentinel — but nothing warns the athlete at the moment of switching.                                                                       |
| L5  | `GoalStep.tsx:140` (repo-wide)                                 | READ     | `mafHrDataAvailable` is asked in onboarding **and** Settings, stored, round-tripped through the preferences API, and read by **no calculation**. MAF ceilings and compliance are produced identically whether or not the athlete can measure HR.                            |
| L6  | `trainingLoadService.ts:1047-1049`; `unitConversion.ts:52, 55` | READ     | Strength and cardio stress are each rounded to 1 dp _before_ being summed into UTSS and rounded again. Metres-per-mile is defined twice (1609.34 vs 1/0.621371), differing by 2.5 ppm.                                                                                      |
| L7  | `client/src/lib/dateUtils.ts:31-60`                            | REPORTED | `getStartOfWeek`/`getEndOfWeek` default to `weekStartsOn = 0` (Sunday) while the rest of the app is Monday-start. Callers that omit the argument silently shift the week.                                                                                                   |
| L8  | `trainingLoadService.ts:445-459`                               | REPORTED | `hrZoneBoundaries` has no `hrMax <= hrRest` guard, though `hrReserveRatio` at `:390` has one. A resting HR above max yields an inverted zone table rather than no table.                                                                                                    |
| L9  | `shared/maf.ts:26-29`                                          | REPORTED | The under-16 branch is unreachable (onboarding validates 16–99), and a genuine under-16 athlete is blocked. Maffetone specifies a flat 165 for under-16s; the code would compute `180−age−10`.                                                                              |
| L10 | `client/src/pages/Analytics.tsx:83-87`                         | REPORTED | "Last N days" fetches **N+1** days and leaves the window open-ended at the top. "All time" on the Fuelling tab silently means the last 366 days.                                                                                                                            |
| L11 | `analyticsService.ts:381-392, 426-437`                         | REPORTED | Coverage panels report "N mapped sets analyzed" where N double- and triple-counts sets mapping to several patterns or muscles. The category pie's slices are overlapping per-category session counts, so the whole exceeds the number of sessions.                          |
| L12 | `storage/workouts.ts:901-914`                                  | REPORTED | `fetchBlockAvgRpe`'s "surrounding 4-week block" is a 29-day window that also averages in workouts logged **after** the one being viewed, so an old workout's stat changes retroactively.                                                                                    |
| L13 | `storage/plans.ts:148-168`                                     | REPORTED | `getPlanWeeklyDensity` rounds plan density **up**, suppressing the very warning it exists to raise.                                                                                                                                                                         |
| L14 | `nutrition/refresh.ts:43-45`                                   | READ     | The FatSecret and Spoonacular clients — the only per-serving providers — are **unreachable on current paths** (`foodSearch.ts` wires Edamam/USDA/OFF; `barcode.ts` wires Edamam/OFF). Spoonacular's serving-weight-from-title heuristic is a latent hazard, not a live bug. |
| L15 | `overviewAnalysisService.ts:130`                               | REPORTED | `daysOfHistory` sent to the AI is the count of non-null ACWR points in the 42-day trend, not days of history.                                                                                                                                                               |
| L16 | `analyticsStaleness.ts:34`                                     | REPORTED | Prediction staleness tracks only the latest workout **date**, so same-day and edit-in-place changes never mark it stale.                                                                                                                                                    |

---

## Formula provenance

| Formula               | Canonical                                     | As written                          | Verdict                                                                                                                                                                           |
| --------------------- | --------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mifflin–St Jeor BMR   | `10w + 6.25h − 5a`, `+5` male / `−161` female | `nutritionTargets.ts:64`            | **Exact.** Unknown sex uses the −78 midpoint, flagged with a reason code (never rendered — see M-tier).                                                                           |
| TDEE multipliers      | 1.2 / 1.375 / 1.55 / 1.725 / 1.9              | `nutritionTargets.ts:21`            | **Exact.** No gaps between levels.                                                                                                                                                |
| Epley 1RM             | `w(1 + r/30)`                                 | `analyticsService.ts:45`            | **Exact**, correctly bounded 2–10 reps, `r=1` deliberately excluded.                                                                                                              |
| Tanaka HRmax          | `208 − 0.7 × age`                             | `trainingLoadService.ts:369`        | **Exact** — and the better choice over `220−age`. Falls back to a flat 190 with no age (H3).                                                                                      |
| Karvonen %HRR         | `(HR − rest) / (max − rest)`                  | `trainingLoadService.ts:391`        | **Exact.** Genuine reserve. Zone floors contiguous.                                                                                                                               |
| TSS / hrTSS           | `hours × IF² × 100`                           | `trainingLoadService.ts:494, 512`   | **Matches.** LTHR estimated at 88% HRmax — a heuristic, labelled as one.                                                                                                          |
| ACWR (EWMA)           | `λ = 2/(N+1)`; N = 7 / 28                     | `trainingLoadService.ts:625`        | **Correct** Williams-style EWMA. But **TSB skips the gate** (C3), and seeding depends on the fetch window (H21).                                                                  |
| Foster monotony       | mean daily load ÷ SD                          | `trainingLoadService.ts:653`        | **Breaks at sd = 0** (C1). Formula right; the guard inverts its meaning. Population SD runs ~8% hot (M26).                                                                        |
| Maffetone 180-Formula | `180 − age`, then −10/−5/0/+5 by category     | `shared/maf.ts:20-54`               | **Diverges.** Fabricated −5 at 65+ (C2); categories (a) and (b) collapsed (M6); +5 ungated on history (M6); under-16 uses `180−age−10` where Maffetone specifies a flat 165 (L9). |
| Atwater factors       | 4 / 4 / 9 kcal·g⁻¹                            | `nutritionTargets.ts:29`            | **Exact.** Macros reconcile within rounding (4435.6 vs 4436).                                                                                                                     |
| 7700 kcal·kg⁻¹        | the "3500 kcal/lb" rule                       | `nutritionTargets.ts:29`            | **Conventional but dated** — overstates sustained loss (Hall et al.), and applied to weight _gain_ too, where tissue cost differs.                                                |
| Unit constants        | 2.2046226, 0.6213712, 3.2808399, 1609.344     | `unitConversion.ts:51-55`           | **Correct to 6–7 figures.** Metres-per-mile defined twice (L6).                                                                                                                   |
| Riegel endurance      | `T₂ = T₁(d₂/d₁)^1.06`                         | `featureBuilder.ts:173-192`         | **Present but stretched** — reported as applied well outside its validated domain, alongside uncited fatigue coefficients. Not independently verified.                            |
| UTSS bodyweight term  | _no known source_                             | `trainingLoadService.ts:340`        | **Invented.** `reps × 20` (M2). Distance uses a similarly uncited `× 0.08`.                                                                                                       |
| Governor thresholds   | _no known source_                             | `trainingLoadService.ts:28-29, 364` | **Uncited magic numbers** on an uncalibrated UTSS scale — vector threshold 45, elastic 80, cardio ceiling 2.6, RPE base 1.18, TSB bands +15/+5/−10/−25.                           |

---

## Plan of attack

The register above is 71 items, but it is **not** 71 independent bugs. Sequencing by severity would
mean touching the same files six times. Sequencing by _root cause_ fixes clusters at once and lets
each phase close a whole defect class structurally, the way the fresh-DB CI job did for migrations.

Six root causes account for roughly 50 of the 71 findings:

| Root cause                                                        | Findings                        | Structural fix                                                           |
| ----------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| **A. No unit contract on stored numeric columns**                 | C7, H1, H2, H16, M8, L1, L4, L6 | A units ADR + branded types + a lint rule                                |
| **B. Guards that conflate "no data" with "extreme data"**         | C1, C3, C6, H7, M9, M10, L8     | A shared `Insufficient`/`Unbounded` sentinel, distinct from a value      |
| **C. Numerator and denominator drawn from different populations** | H6, H8, H9, H10, M5, L11        | A pooled-ratio helper; one query per ratio                               |
| **D. Silent fallback constants presented as personalisation**     | C6, H3, H14, M2, M4, M6         | An `Estimated<T>` wrapper the UI is obliged to render                    |
| **E. UTC vs athlete-local time**                                  | H11, H15, M3, L7, L10           | Ban bare `toISOString().slice(0,10)`; route through `server/timezone.ts` |
| **F. Rules that live in prompts, or gates fed constants**         | H13, H17, H18, M7               | Move to validators; pass the real inputs or delete the branch            |

### Phase 0 — Characterisation tests (before any fix)

Nothing here is a crash, so there is no failing signal today. Several existing tests actively assert
the buggy behaviour (`workoutService.test.ts:313` asserts the 60× passthrough; the MAF suite asserts
the age-65 cliff). Before changing behaviour, write tests that **fail now** and encode the intended
answer, and mark the tests that must be _inverted_ rather than kept.

Deliverable: one PR of `*.audit.test.ts` files, all failing, referencing finding IDs. This is the
only phase that should land red.

**Done when:** every C-tier and H-tier finding has a red test naming its ID.

### Phase 1 — Units (root cause A)

Highest severity-to-effort ratio, and three of the seven criticals. Three independent
minutes/seconds confusions around one column reads less like three slips than like a column whose
unit was never pinned down.

1. Write `docs/adr-units.md`: canonical storage units per column, and the rule that a column's unit
   lives in its name or its type, never in a comment.
2. Introduce branded types in `shared/units.ts` (`Minutes`, `Seconds`, `Kilograms`, `Metres`) so
   `Seconds → Minutes` is a compile error. Start with `exercise_sets.time`.
3. Fix C7, H1, H2 behind those types. Invert `workoutService.test.ts:313`.
4. Fix the hardcoded suffixes (H16, H2, M8) by routing every render through the existing
   preference-aware formatters.
5. Decide L4: either canonicalise stored weights on write (migration + backfill) or warn at the
   moment the athlete switches preference. The S5 sentinel already documents the trade-off; this is
   a product call, not a technical one.

**Done when:** `grep` finds no arithmetic mixing a `*Seconds` and a `*Minutes` identifier, and no
hardcoded `"kg"`/`"m"`/`"min"` suffix outside the formatter modules.

### Phase 2 — Safety guards (root cause B)

These are the numbers an athlete could get hurt acting on.

1. **C1** — split the zero-SD cases; two-pass variance; `monotonyZone(null)` must not return `"ok"`.
   This is the single highest-value fix in the register: it re-arms four surfaces at once.
2. **C3** — move the TSB assignment below the `ratioFrom` gate; refuse a "peaked" verdict when acute
   load is near zero.
3. **C5** — re-check the calorie floor in `effectiveTargetWindowed`, and emit the reason code.
4. **M9, L8** — gate monotony behind the same history requirement as ACWR; mirror the `:390` guard.
5. **C2, M6, L9** — rewrite the MAF branch order to follow Maffetone: categories first, then the 65+
   exception as an _upward_ adjustment. If a conservative default for older athletes is a deliberate
   product decision, stop citing Maffetone and say so in the UI.

**Done when:** the Phase 0 tests for C1/C2/C3/C5 are green, and a property test asserts no age
boundary reduces a MAF ceiling.

### Phase 3 — Denominators and windows (root cause C)

Mostly one file (`analyticsService.ts`) and one shape of mistake.

1. Add `pooledRatio(numerator, denominator)` and a `weightedMean(values, weights)` helper; forbid
   `mean(perItemMeans)` in review.
2. Zero-fill the week range before any per-week aggregate (fixes H7 and M10 together).
3. Fix H8 by dividing by the count of logs that carry a duration.
4. Fix H6 — the rate must be plan days completed ÷ plan days due, from one query. Delete the
   misleading caption.
5. Fix H10, M5, L11, L12, M12: adherence over _due_ sessions, exclude today from completion rate,
   stop double-counting multi-mapped sets, bound the block window, exclude the current workout from
   its own PR baseline.

**Done when:** every ratio in `analyticsService.ts` and `storage/analytics.ts` is produced by the
shared helper, and each has a test with a zero-activity period in the window.

### Phase 4 — Time (root cause E)

`server/timezone.ts` is already correct and DST-safe; the problem is that half the callers bypass it.

1. Add an ESLint rule banning `toISOString().slice(0,10)` / `.split("T")[0]` outside
   `server/timezone.ts` and `shared/dateUtils.ts`.
2. Thread `userTimezone` into `getMondayWeekBoundaries` (it is already in scope at
   `analyticsService.ts:527`) and delete the UTC-only variant.
3. Fix L7's Sunday default; fix M3 and L10's off-by-one windows.
4. Fix H15: treat an ended plan as inactive rather than clamping into `race_week`.

**Done when:** the lint rule passes clean, and one test asserts a UTC−8 athlete and a UTC+13 athlete
see the same session in the same week.

### Phase 5 — Fallback provenance (root cause D)

The pattern: a default is substituted for missing data, and the UI presents it as a measurement.

1. Introduce `Estimated<T> = { value: T; basis: "measured" | "estimated"; because: string }`.
   `energyBalance.ts` already does this informally with `basis` and `reasonCodes` — generalise it.
2. Make the reason codes _render_. Several already exist and are discarded by the UI
   (`sex_neutral_bmr`, `assumed_moderate_activity`, the meal-target warnings).
3. **C6** — pass the athlete's real `recentAvgDailyUtss` into `defaultPeriodizationConfig`. The
   argument already exists; only the call site is wrong. Cheapest critical fix in the register.
4. **H3** — collect `age` outside the optional nutrition step, and withhold or label HR zones when
   it is absent.
5. **M4** — widen the run-pace plausibility band to real beginner paces and relax the clamp once n
   is adequate.
6. **M2** — scale bodyweight movements by the athlete's bodyweight × a per-movement fraction, and
   cite the source.

**Done when:** no calculation substitutes a constant for missing athlete data without returning a
basis the UI renders.

### Phase 6 — Dead gates and unenforced rules (root cause F)

1. **H13** — pass the real race date and recovery markers into the decision engine, or delete the
   branches. A gate fed a literal is worse than no gate: it reads as protection in review.
2. **H17, M7** — move the 2.5–5%/week ceiling and the deload out of the prompt and into the plan
   validator. Generate chunks sequentially with the prior chunk's loads in context, or validate
   across the seam.
3. **H18** — match rest status explicitly, never by substring, and never destructively.
4. **M23, M24** — order governor passes by severity; stop the recovery-run rewrite copying the
   original pace.

**Done when:** no `if` in the decision engine or governor depends on a value that is a literal at
its only call site, and a generated plan is rejected if any week exceeds the prior week's load by
more than the configured ceiling.

### Cross-cutting: prevent the class, not the instance

Worth landing alongside the phases above:

- **Property tests over invariants**, not just examples: monotonicity (no age boundary makes an
  athlete faster or lower-ceilinged), unit round-trips, ratios in [0, 1], no NaN/Infinity reaching a
  formatter.
- **A "no silent default" review rule**: a `??` or `||` supplying a _domain_ constant (not a
  structural one) needs a reason code and a UI surface.
- **Update `TECHNICAL_DEBT.md`** with the C-tier items so they are tracked in the living registry
  rather than only in this snapshot.

### Suggested sequencing

Phases 1 and 2 are independent and can run in parallel. Phase 3 should follow Phase 0. Phases 4–6
can be interleaved. A reasonable first PR is Phase 0 plus C6 (a one-line fix with a large numeric
effect) and C1 (the highest-value guard), which together close two criticals and arm the test suite.

---

## Corrections and refutations

Recorded because a wrong finding costs more than a missing one, and because both of these corrected
an earlier draft of this document.

**1. "Monotony explodes to ~7×10⁷ from float cancellation" — I refuted this in error.**
The first refutation tested identical values at 9.9, 10, 80, 100 — all of which happen to cancel
exactly — and separately tested _near_-identical values with a 0.1 offset. It never tested identical
values at a magnitude whose square does not cancel. The adversarial verifier did, executed the real
engine, and was right. The claim is confirmed and is folded into C1: one unstable expression, two
different wrong answers for identical input, selected by a float bit pattern.

**2. "Spoonacular guesses the serving weight from the product title" — downgraded to dead code.**
The mapping code does infer a per-serving gram weight from an ounce token in the product title. But
`foodSearch.ts:140-144` wires only Edamam/USDA/OFF and `barcode.ts:30` only Edamam/OFF. The only
other caller is `nutrition/refresh.ts:43-45`, a background refresh dispatched on an existing row's
`source` — which nothing currently creates. Real code, unreachable path; recorded as L14. A second
agent auditing the same domain caught the reachability gap the first one missed.

---

## Not verified

Stated explicitly rather than assumed fine:

- **Every `REPORTED` row.** These passed the fleet's adversarial verifier but were not re-derived by
  hand. Given that pass confirmed 190 of 225, they are likely sound — but the Spoonacular correction
  shows what a second reader catches.
- **Food provider payloads.** The architecture is sound (each client maps to `*Per100g`; `rollup.ts`
  is the single scaling point), and only Edamam/USDA/OFF are wired up. Those three were not exercised
  against real responses, which is where a per-serving slip would hide. M19 is the first to check.
- **`open|female` wall balls at 260 s** (`raceBenchmarks.generated.ts:33`) looks low next to its
  neighbours, but there is no authoritative dataset here to judge it against. Marked _undetermined_
  by the verifier, and left that way.
- **Device calorie semantics.** H14 and M16 assume Strava's and Garmin's `calories`/`kilojoules`
  fields are gross work rather than active metabolic energy. That is their documented meaning, but it
  was not confirmed against live payloads.
- **Existing test suites** were read for intent only. Several assert the current behaviour of C1, C2
  and C7, so the suite is green _because_ those bugs are baked into its expectations. See Phase 0.
