# Mathematical Audit & Verification Report — 2026-10-18

**Scope:** End-to-end verification of all mathematical models, physiological equations, statistical aggregations, signal-processing algorithms, nutrition/energy-balance formulas, and unit conversions across `shared/`, `server/`, and `client/`.

**Method:** Every mathematical module in the repository was read line-by-line against primary exercise-science, statistical, and physics definitions, cross-checked against all callers, and verified against prior calculation audits ([`docs/CALCULATION_AUDIT_2026-08-20.md`](CALCULATION_AUDIT_2026-08-20.md) and `CODEBASE_ANALYSIS_2026-10-03`). Every newly identified finding below is marked `EXECUTED` and was reproduced by importing and running the shipping TypeScript modules against constructed athlete inputs.

---

## 1. Executive Summary

Following the extensive remediation work in [`docs/CALCULATION_AUDIT_2026-08-20.md`](CALCULATION_AUDIT_2026-08-20.md), the vast majority of the **Hyrox Companion** mathematical infrastructure is **mathematically exact, dimensionally consistent, and numerically stable**.

Key mathematical strengths verified across the codebase include:
- **Zero-start bias-corrected EWMA** ($\sum w_k = 1$) for Acute and Chronic Training Load ([`loadDynamics.ts`](../server/services/trainingLoad/loadDynamics.ts)), eliminating cold-start underestimation while converging to the standard infinite-impulse-response EWMA.
- **Two-pass sample standard deviation** ($N - 1$ denominator) for Foster's Training Monotony and Strain ([`loadDynamics.ts`](../server/services/trainingLoad/loadDynamics.ts)), preventing catastrophic cancellation and properly separating zero-load weeks from flat uniform-load weeks.
- **Exact Daniels–Gilbert $\text{VO}_2$ velocity polynomials** and closed-form quadratic inversion for running pace prescription ([`running.ts`](../server/services/workoutEngine/running.ts)).
- **Time-weighted Riemann integration** of irregular Strava/Garmin telemetry streams ([`downsample.ts`](../server/services/sessionGrades/downsample.ts)), coupled with **Otsu's method** (maximizing between-class variance $\sigma_B^2$) for unsupervised interval work/rest segmentation ([`workSegments.ts`](../server/services/sessionGrades/workSegments.ts)).
- **Pooled ratios (`pooledRatio`, `weightedMean`)** ([`ratio.ts`](../shared/ratio.ts)) and **late rounding** ([`nutritionScaling.ts`](../shared/nutritionScaling.ts)) that prevent unweighted average-of-averages distortions and cumulative rounding drift.
- **Thermodynamic vs. physiological energy conversion** that properly separates metabolizable food kilojoules ($0.239\text{ kcal/kJ}$ in [`offClient.ts`](../server/services/nutrition/offClient.ts)) from mechanical cycling pedal kilojoules ($\frac{0.239}{0.24} \approx 0.996\text{ kcal/kJ}$ in [`stravaMapper.ts`](../server/services/stravaMapper.ts)).

However, our audit identified **5 remaining mathematical and logical flaws** (2 High, 3 Medium) where valid athlete inputs produce silently wrong numbers, inverted metrics, or dropped load components.

---

## 2. Newly Identified Mathematical & Logical Flaws

| ID | Severity | Status | Module | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **M-NEW-1** | **High** | `EXECUTED` | [`server/services/trainingLoadService.ts`](../server/services/trainingLoadService.ts)<br>[`server/services/trainingLoad/stressScores.ts`](../server/services/trainingLoad/stressScores.ts) | Functional weighted-distance sets (`sled_push`, `sled_pull`, `farmers_carry`, `sandbag_lunges`, and 5 other carries) are excluded by `isStrengthSet` (`strengthStressScore = 0`), and `calculateStrengthStressScore` ignores `weight` whenever `reps === 0`. |
| **M-NEW-2** | **High** | `EXECUTED` | [`server/services/ai/trainingStats.ts`](../server/services/ai/trainingStats.ts) | `getStructuredExerciseStats` / `updateExerciseStat` exhibits stepwise integer rounding freeze on `avgReps` for $n \ge 3$, divides by non-rep sets, takes minimum `bestTime` on isometric holds (inverting plank/hang bests), and pools custom exercises under `"custom"`. |
| **M-NEW-3** | **Medium** | `EXECUTED` | [`shared/nutritionTargets.ts`](../shared/nutritionTargets.ts) | When `baseLoad.raw + recovery.raw + preload.raw === 0` (exact cancellation between a rest/light-day cut and recovery + pre-load top-up), `scale` evaluates to `0` instead of `1`, wiping out all three component deltas to `0g` and reporting `"Flat baseline target (no training-load periodisation applied)."`. |
| **M-NEW-4** | **Medium** | `EXECUTED` | [`server/services/workoutEngine/loadMath.ts`](../server/services/workoutEngine/loadMath.ts)<br>[`server/services/workoutEngine/trainingTargets.ts`](../server/services/workoutEngine/trainingTargets.ts) | `EngineSet` omits `customLabel` and `collectSessionBests` keys on `set.exerciseName` (`"custom"`) rather than `liftKey(set)` (`"custom:<label>"`), pooling distinct custom lifts together and discarding heavy custom lifts as "+10% outliers" above light custom lifts. |
| **M-NEW-5** | **Medium** | `EXECUTED` | [`server/services/racePrediction/featureBuilder.ts`](../server/services/racePrediction/featureBuilder.ts) | `accumulateSetMetrics` computes `maxLoad` across *all* sets of a station (including untimed sets and short-distance heavy sets rejected by `projectedSplitSeconds`), decoupling `loadRatio` from the timed sets that produced `medianSeconds` and lacks an upper plausibility bound. |

---

### Detailed Breakdown of Findings

#### M-NEW-1 (`EXECUTED` — High): Weighted-Distance Functional Sets Excluded or Ignored in Strength Stress Calculation
- **Locations:**
  - `isStrengthSet` in [`server/services/trainingLoadService.ts:85-93`](../server/services/trainingLoadService.ts#L85-L93)
  - `calculateStrengthStressScore` in [`server/services/trainingLoad/stressScores.ts:102-108`](../server/services/trainingLoad/stressScores.ts#L102-L108)
- **Current Implementation:**
  ```ts
  // server/services/trainingLoadService.ts:85-93
  function isStrengthSet(set: TrainingLoadSet): boolean {
    const reps = Number(set.reps ?? set.plannedReps ?? 0);
    const weight = Number(set.weight ?? set.plannedWeight ?? 0);
    return (
      set.category === "strength" ||
      (reps > 0 && weight > 0) ||
      (reps > 0 && (set.category === "conditioning" || set.category === "functional"))
    );
  }
  ```
  ```ts
  // server/services/trainingLoad/stressScores.ts:102-108
  let weightedTonnage = 0;
  if (weight > 0 && reps > 0) {
    weightedTonnage = weight * Math.max(reps, 1);
  } else if (reps > 0) {
    weightedTonnage = reps * bodyweightRepLoadKg(athleteBodyweightKg);
  } else if (distance > 0) {
    weightedTonnage = distance * 0.08;
  }
  ```
- **Mathematical Proof of Defect:**
  1. In [`shared/schema/exercises.ts:2-17`](../shared/schema/exercises.ts#L2-L17), nine weighted-distance exercises—including four core HYROX stations (`sled_push`, `sled_pull`, `farmers_carry`, `sandbag_lunges`) plus `suitcase_carry`, `overhead_carry`, `front_rack_carry`, `yoke_carry`, and `sandbag_carry`—have `category: "functional"` and `fields: ["distance", "time", "weight"]` (no `reps`).
  2. When an athlete logs $4 \times 50\text{ m}$ `sled_push` at $200\text{ kg}$ (`reps = null`), `reps > 0` is `false` and `set.category === "strength"` is `false`. Consequently, `isStrengthSet` returns `false`, and `applyStrengthLoad` skips every set.
  3. Although the comment at `stressScores.ts:93-95` explicitly notes that the `else if (distance > 0)` branch exists for *"a distance-only strength set (a carry, a sled push)"*, that branch is unreachable via `applyStrengthLoad` for any catalogue carry or sled push with `category: "functional"`.
  4. Furthermore, even when `calculateStrengthStressScore` is called directly (or when `category === "strength"`), the `else if (distance > 0)` branch computes `weightedTonnage = distance * 0.08` and completely ignores `weight`.
- **Executed Verification:**
  - Calling `calculateTrainingLoad` on a 30-minute RPE-8 session containing $4 \times 50\text{ m}$ `sled_push` @ $200\text{ kg}$ produces:
    ```json
    { "strengthStressScore": 0, "cardioStressScore": 56.4, "utss": 56.4 }
    ```
  - Calling `calculateStrengthStressScore` directly on $50\text{ m}$ `sled_push` @ $200\text{ kg}$ vs. $50\text{ m}$ @ $0\text{ kg}$ produces:
    ```json
    { "directStress200kg": 0.07, "directStress0kg": 0.07 }
    ```
- **Recommended Fix:**
  - In `isStrengthSet`, include `(distance > 0 && weight > 0)` (or `(distance > 0 && (set.category === "strength" || set.category === "functional"))`).
  - In `calculateStrengthStressScore`, scale distance tonnage by `weight` when `weight > 0 && distance > 0` (e.g., incorporating `weight` relative to a reference load or `weight * distance * k`), while keeping unweighted distance at `distance * 0.08`.

---

#### M-NEW-2 (`EXECUTED` — High): Stepwise Integer Rounding Freeze, Denominator Mismatch, Inverted Hold Times & Custom Key Collision in `getStructuredExerciseStats`
- **Locations:**
  - `updateExerciseStat` and `getStructuredExerciseStats` in [`server/services/ai/trainingStats.ts:193-247`](../server/services/ai/trainingStats.ts#L193-L247)
  - Consumers: `buildStructuredPerformance` in [`server/prompts/coachingContext.ts:129-146`](../server/prompts/coachingContext.ts#L129-L146) and `formatPerformanceStats` in [`server/gemini/suggestionService.ts:220-232`](../server/gemini/suggestionService.ts#L220-L232)
- **Current Implementation:**
  ```ts
  // server/services/ai/trainingStats.ts:193-212, 238-242
  function updateExerciseStat(
    stat: { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number },
    es: { weight: number | null; distance: number | null; time: number | null; reps: number | null }
  ) {
    stat.count++;
    if (es.weight) {
      if (!stat.maxWeight || es.weight > stat.maxWeight) stat.maxWeight = es.weight;
    }
    if (es.distance) {
      if (!stat.maxDistance || es.distance > stat.maxDistance) stat.maxDistance = es.distance;
    }
    if (es.time) {
      if (!stat.bestTime || es.time < stat.bestTime) stat.bestTime = es.time;
    }
    if (es.reps) {
      stat.avgReps = stat.avgReps
        ? Math.round((stat.avgReps * (stat.count - 1) + es.reps) / stat.count)
        : es.reps;
    }
  }
  ...
  for (const es of entry.exerciseSets) {
    hasStats = true;
    if (!stats[es.exerciseName]) stats[es.exerciseName] = { count: 0 };
    updateExerciseStat(stats[es.exerciseName], setInDisplayUnits(es, preferences));
  }
  ```
- **Mathematical Proof of 4 Compounding Defects:**
  1. **Stepwise Integer Rounding Fixed-Point Trap:** Let $\hat{\mu}_n \in \mathbb{Z}$ be the rounded running average at step $n$:
     $$\hat{\mu}_n = \operatorname{round}\!\left(\frac{(n-1)\hat{\mu}_{n-1} + x_n}{n}\right) = \operatorname{round}\!\left(\hat{\mu}_{n-1} + \frac{x_n - \hat{\mu}_{n-1}}{n}\right)$$
     Whenever $|x_n - \hat{\mu}_{n-1}| < \frac{n}{2}$, the increment $\frac{x_n - \hat{\mu}_{n-1}}{n}$ is strictly less than $0.5$ in magnitude and rounds to $0$, so $\hat{\mu}_n = \hat{\mu}_{n-1}$ permanently. For $n \ge 3$, a $+1$ rep improvement ($x_n = \hat{\mu}_{n-1} + 1$) never changes `avgReps`.
  2. **Denominator Population Mismatch:** `stat.count++` executes unconditionally before `if (es.reps)` (pinned by a characterization test at `trainingStats.test.ts:407-417`, but still live in production). Any set without `reps` increments `stat.count`, depressing `avgReps` on all subsequent rep-bearing sets.
  3. **Direction-Unaware & Un-Bucketed `bestTime`:** Unlike [`analyticsService.ts`](../server/services/analyticsService.ts) (which was fixed in `C1` and `H4`), `updateExerciseStat` unconditionally evaluates `es.time < stat.bestTime`. For isometric holds (`plank`, `dead_hang`, `wall_sit`, `l_sit_hold`) where longer is better, it records the **shortest** hold as `bestTime`, and for distance/rep exercises it compares times across incompatible distances (e.g., a $50\text{ m}$ interval vs. a $1000\text{ m}$ piece).
  4. **Custom Exercise Key Collision:** `stats[es.exerciseName]` buckets every custom exercise under `"custom"` rather than `custom:<label>`.
- **Executed Verification:**
  - Passing `back_squat` sets with `reps = [10, 10, 11, 11, 11, 11, 11]` (true mean $\frac{75}{7} \approx 10.714$, rounded true mean $11$) into `getStructuredExerciseStats` returns:
    ```json
    { "count": 7, "maxWeight": 100, "avgReps": 10 }
    ```
  - Passing `plank` sets with `time = [0.5, 1.0, 0.33]` minutes ($30\text{ s}$, $60\text{ s}$, $20\text{ s}$) into `getStructuredExerciseStats` returns:
    ```json
    { "count": 3, "bestTime": 0.33 }
    ```
- **Recommended Fix:**
  - Accumulate `repSum` and `repCount` separately and compute `avgReps = Math.round(repSum / repCount)` once after the loop (or via `pooledRatio`).
  - Key `stats` by `es.exerciseName === "custom" && es.customLabel ? "custom:" + es.customLabel : es.exerciseName`, and apply `isLongerBetterHold` for hold-only exercises.

---

#### M-NEW-3 (`EXECUTED` — Medium): Zero-Sum Cancellation Wipes Out Periodization Breakdown & Explanation in `effectiveTargetWindowed`
- **Location:** `effectiveTargetWindowed` in [`shared/nutritionTargets.ts:467-512`](../shared/nutritionTargets.ts#L467-L512)
- **Current Implementation:**
  ```ts
  // shared/nutritionTargets.ts:467-498
  const rawSum = baseLoad.raw + recovery.raw + preload.raw;
  ...
  const desiredDelta = Math.min(cap, rawSum);
  const appliedDelta = Math.max(Math.max(zeroCarbBound, calorieFloorBound), desiredDelta);
  ...
  const scale = rawSum !== 0 ? appliedDelta / rawSum : 0;

  const baseLoadDeltaG = round1(baseLoad.raw * scale);
  const recoveryDeltaG = round1(recovery.raw * scale);
  const preloadDeltaG = round1(preload.raw * scale);
  ```
- **Mathematical Proof of Defect:**
  - `baseLoad.raw` is signed: $\text{baseLoad.raw} = (\text{dayUtss} - \text{reference}) \times \text{slope}$, which is **negative** on rest or light days ($\text{dayUtss} < \text{reference}$).
  - `recovery.raw` and `preload.raw` are **non-negative** top-ups for yesterday's debt and tomorrow's planned load.
  - Whenever the positive recovery + pre-load top-up exactly balances the negative base-load reduction, $\text{rawSum} = \text{baseLoad.raw} + \text{recovery.raw} + \text{preload.raw} = 0$, and $\text{appliedDelta} = 0$.
  - Even though **neither the cap nor the floor bound was active** ($\text{appliedDelta} = \text{rawSum}$), the ternary `rawSum !== 0 ? appliedDelta / rawSum : 0` evaluates to $\text{scale} = 0$ instead of $1$.
  - Multiplying by $\text{scale} = 0$ zeroes out `baseLoadDeltaG = 0`, `recoveryDeltaG = 0`, and `preloadDeltaG = 0`, which then causes `buildExplanation` (`shared/nutritionTargets.ts:390`) to hit `if (parts.length === 0 && carbDeltaG === 0)` and report that no periodization was applied at all!
- **Executed Verification:**
  - With `referenceUtss = 60`, `slopeGPerUtss = 1.5`, `dayUtss = 30` ($\text{baseLoad.raw} = -45\text{ g}$), `pastUtss = [120]` ($\text{recovery.raw} = +27\text{ g}$), and `futurePlannedUtss = [100]` ($\text{preload.raw} = +18\text{ g}$), `effectiveTargetWindowed` returns:
    ```json
    {
      "carbDeltaG": 0,
      "baseLoadDeltaG": 0,
      "recoveryDeltaG": 0,
      "preloadDeltaG": 0,
      "explanation": "Flat baseline target (no training-load periodisation applied)."
    }
    ```
- **Recommended Fix:**
  - Define `const scale = rawSum !== 0 ? appliedDelta / rawSum : 1;` so unclipped zero-sum days preserve their true component deltas (`baseLoadDeltaG: -45`, `recoveryDeltaG: 27`, `preloadDeltaG: 18`) while summing to `carbDeltaG: 0`.

---

#### M-NEW-4 (`EXECUTED` — Medium): Custom Exercise Key Collision in `collectSessionBests` & `estimateStrength` (`loadMath.ts`)
- **Locations:**
  - `EngineSet`, `liftKey`, `collectSessionBests`, and `estimateStrength` in [`server/services/workoutEngine/loadMath.ts:22-33, 62-69, 132-194`](../server/services/workoutEngine/loadMath.ts#L22-L194)
  - Downstream caller: `buildTrainingTargets` in [`server/services/workoutEngine/trainingTargets.ts:39-64`](../server/services/workoutEngine/trainingTargets.ts#L39-L64) and `formatTrainingTargets` in [`server/prompts/workoutEngine.ts:250-268`](../server/prompts/workoutEngine.ts#L250-L268)
- **Current Implementation:**
  ```ts
  // server/services/workoutEngine/loadMath.ts:62-69
  export function liftKey(set: {
    readonly exerciseName: string;
    readonly customLabel?: string | null;
  }): string {
    return set.exerciseName === "custom" && set.customLabel
      ? `${CUSTOM_LIFT_PREFIX}${set.customLabel}`
      : set.exerciseName;
  }
  ...
  // server/services/workoutEngine/loadMath.ts:147-151
  let sessions = byExercise.get(set.exerciseName);
  if (!sessions) {
    sessions = new Map();
    byExercise.set(set.exerciseName, sessions);
  }
  ```
- **Mathematical / Keying Proof of Defect:**
  - `liftKey` was added to `loadMath.ts` (under `D14`) specifically so custom lifts (`exerciseName === "custom"`) are keyed as `custom:<label>`. Callers in [`adaptation.ts:247, 409`](../server/services/workoutEngine/adaptation.ts#L247) and [`planGenerationService.ts:510, 682`](../server/services/planGenerationService.ts#L510) use `liftKey`.
  - However, inside `loadMath.ts` itself, `EngineSet` (`lines 22-33`) omits `customLabel`, and `collectSessionBests` (`line 147`) buckets by `set.exerciseName` (`"custom"`) instead of `liftKey(set)` (while skipping unlabeled `"custom"` rows).
  - Consequently, when `buildTrainingTargets` calls `estimateStrength`, every custom exercise the athlete has logged is pooled into a single `"custom"` lift:
    1. Two completely different custom exercises logged once each on different days satisfy `sessions.size >= MIN_SESSIONS` ($2$).
    2. Worse, because `estimateStrength` applies a $+10\%$ outlier rejection filter (`best.e1rm > second.e1rm * (1 + OUTLIER_MARGIN) ? second : best`), a heavy custom lift (e.g., Hip Thrust at $150\text{ kg} \times 5$, $\text{e1RM} = 185\text{ kg}$) is classified as a "data-entry outlier" relative to a lighter custom lift (e.g., Lateral Raise at $12\text{ kg} \times 10$, $\text{e1RM} = 16.8\text{ kg}$) and discarded!
- **Executed Verification:**
  - Calling `buildTrainingTargets` on one session of Custom `"Hip Thrust"` ($150\text{ kg} \times 5$) and one session of Custom `"Lateral Raise"` ($12\text{ kg} \times 10$) returns:
    ```json
    [
      {
        "exercise": "custom",
        "e1rm": 16.8,
        "basis": { "date": "2026-10-03", "weight": 12, "reps": 10 },
        "sessions": 2,
        "fiveAtRpe8": 12.5,
        "eightAtRpe8": 12.5
      }
    ]
    ```
    This feeds `formatTrainingTargets` (`server/prompts/workoutEngine.ts:258`), instructing the AI coach:
    `- Custom Exercise: est. 1RM 16.8 kg (from 12 kg x 10 on 2026-10-03) → 5 reps @ RPE 8 ≈ 12.5 kg · 8 reps @ RPE 8 ≈ 12.5 kg`.
- **Recommended Fix:**
  - Add `readonly customLabel?: string | null;` to `EngineSet` in `loadMath.ts`, key `collectSessionBests` by `const key = liftKey(set)` (ignoring sets where `key === "custom"` with no label, matching `loggedLift` in `adaptation.ts:246-249`), and resolve `customLiftLabel(lift.exercise)` in `formatTrainingTargets`.

---

#### M-NEW-5 (`EXECUTED` — Medium): Decoupled All-Set `maxLoad` & Unbounded `loadRatio` in Race Prediction (`featureBuilder.ts`)
- **Location:** `loadAdjust`, `accumulateSetMetrics`, `buildSegmentFeature`, and `buildRacePredictionFeatures` in [`server/services/racePrediction/featureBuilder.ts:163-168, 304-380, 476-477`](../server/services/racePrediction/featureBuilder.ts#L163-L380)
- **Current Implementation:**
  ```ts
  // server/services/racePrediction/featureBuilder.ts:320-335
  for (const set of sets) {
    const seconds = projectedSplitSeconds(set, target, units.distanceUnit, exponent);
    if (seconds != null) {
      pushToBucket(sessionSplits, set.workoutLogId, seconds);
      if (bestSeconds == null || seconds < bestSeconds) bestSeconds = seconds;
    }
    if (set.weight != null && Number.isFinite(set.weight)) {
      const weight = storedWeightToDisplay(set.weight, set, units);
      if (maxLoad == null || weight > maxLoad) {
        maxLoad = weight;
      }
    }
    ...
  }
  ```
  ```ts
  // server/services/racePrediction/featureBuilder.ts:476-477
  const raceEquiv =
    loadAdjust(feature.medianSeconds, feature.loadRatio) * STATION_FATIGUE_FACTOR;
  ```
- **Mathematical Proof of Defect:**
  1. `feature.medianSeconds` is computed exclusively from **timed sets whose distance/reps fall within the $[0.5, 2.0]$ trust band** (`seconds != null`).
  2. However, `maxLoad` (which defines `feature.loadRatio = maxLoad / standardLoadUserUnit`) is maximized over **every set of that station in history**, including:
     - **Untimed sets** (`time: null`, where `seconds == null`), and
     - **Short-distance heavy strength sets** (e.g., a $15\text{ m}$ heavy sled push) that `projectedSplitSeconds` explicitly rejected as outside the $[0.5, 2.0]$ distance trust band.
  3. Because `loadAdjust(seconds, loadRatio)` multiplies `feature.medianSeconds` by $\operatorname{clamp}(1 + 0.25(1 - \text{loadRatio}), 0.85, 1.25)$, a fast split recorded with a **light** implement ($W_{\text{timed}} < W_{\text{spec}}$) is adjusted using the weight of a completely different **heavy** untimed set ($W_{\text{untimed}} > W_{\text{spec}}$), shifting the predicted race split in the **wrong direction** (discounting the time instead of penalizing it).
  4. Additionally, while distance and rep ratios are gated to $[0.5, 2.0]$ via `trustedFactor`, `loadRatio` has no plausibility gate (`[0.5, 2.0]`) to reject unit-entry typos before clamping.
- **Executed Verification:**
  - Athlete logs a timed $50\text{ m}$ `sled_push` in $2.75\text{ min}$ ($165\text{ s}$) at **$102\text{ kg}$** (lighter than the $152\text{ kg}$ Men's Open spec, so $\text{loadRatio} = \frac{102}{152} = 0.671$):
    - `loadAdjust` applies a $+8.2\%$ penalty ($1 + 0.25(1 - 0.671) = 1.0822$), giving a race-equivalent split of $\operatorname{round}(165 \times 1.0822 \times 1.10) = \mathbf{196\text{ s}}$.
  - The athlete then logs an **untimed** heavy strength set of $15\text{ m}$ `sled_push` at **$220\text{ kg}$** (`time: null`, rejected by `projectedSplitSeconds`):
    - `feature.loadRatio` jumps from $0.671$ to $\frac{220}{152} = 1.447$.
    - `loadAdjust` now applies an $-11.2\%$ **discount** ($1 + 0.25(1 - 1.447) = 0.888$) to the light $102\text{ kg}$ time, dropping the predicted race split from $\mathbf{196\text{ s}}$ to $\mathbf{161\text{ s}}$ (**$35\text{ seconds}$ faster** from an untimed set!).
- **Recommended Fix:**
  - Apply `loadAdjust` per timed set inside `projectedSplitSeconds` (using that specific set's stamped weight when present), or restrict `maxLoad` to the timed sets that actually contributed to `sessionSplits`.

---

## 3. Domain-by-Domain Mathematical Verification

### Domain 1: Training Load, Physiology & Stress Scores

#### 1.1 Maximum Heart Rate & Karvonen Heart Rate Reserve ([`server/services/trainingLoad/hrModel.ts`](../server/services/trainingLoad/hrModel.ts))
- **Formulas:**
  $$\text{HR}_{\max} = \begin{cases} \operatorname{round}(\text{maxHr}) & \text{if measured } \text{maxHr} \in [120, 230] \\ \operatorname{clamp}(\operatorname{round}(208 - 0.7 \times \text{age}), 120, 220) & \text{if } \text{age} \in [12, 100] \\ 185 \text{ (basis: assumed)} & \text{otherwise} \end{cases}$$
  $$\text{HRR} = \operatorname{clamp}\!\left(\frac{\text{HR}_{\text{avg}} - \text{HR}_{\text{rest}}}{\text{HR}_{\max} - \text{HR}_{\text{rest}}},\; 0,\; 1\right)$$
- **Verification:** ✅ **Correct.** Uses the Tanaka, Monahan & Seals (2001) equation ($\text{HR}_{\max} = 208 - 0.7 \times \text{age}$) and the Karvonen Heart Rate Reserve ratio. When `basis === "assumed"` (neither measured $\text{HR}_{\max}$ nor age is on the profile), [`trainingLoadService.ts:198-202`](../server/services/trainingLoadService.ts#L198-L202) and [`heartRateConsistency.ts:170-172`](../server/services/heartRateConsistency.ts#L170-L172) withhold HR-based stress and zone metrics rather than computing them against a fabricated $185\text{ bpm}$ ceiling.

#### 1.2 Cardio Stress Score, hrTSS & powerTSS ([`server/services/trainingLoad/stressScores.ts`](../server/services/trainingLoad/stressScores.ts))
- **Formulas:**
  - **Unified Cardio Stress Score:**
    $$\text{CardioStress} = t_{\min} \times \left(0.6 + 2 f^2\right)$$
    where the intensity fraction $f$ is selected by priority:
    1. Power: $f = \min\!\left(1.5, \frac{P_{\text{avg}}}{\text{FTP}}\right)$
    2. Heart Rate Reserve: $f = \text{HRR} \in (0, 1]$
    3. Session RPE: $f = \frac{\operatorname{clamp}(\text{RPE}, 1, 10)}{10} \in [0.1, 1.0]$
  - **Heart Rate Training Stress Score ($\text{hrTSS}$):**
    $$\text{LTHR} = \max\!\left(\operatorname{round}(0.88 \cdot \text{HR}_{\max}),\; \text{HR}_{\text{rest}} + 1\right)$$
    $$\text{IF}_{\text{HR}} = \operatorname{clamp}\!\left(\frac{\text{HR}_{\text{avg}} - \text{HR}_{\text{rest}}}{\text{LTHR} - \text{HR}_{\text{rest}}},\; 0,\; 1\right), \qquad \text{hrTSS} = \frac{t_{\min}}{60} \times \text{IF}_{\text{HR}}^2 \times 100$$
  - **Power Training Stress Score ($\text{powerTSS}$):**
    $$\text{IF}_{P} = \operatorname{clamp}\!\left(\frac{P_{\text{avg}}}{\text{FTP}},\; 0,\; 1.5\right), \qquad \text{powerTSS} = \frac{t_{\min}}{60} \times \text{IF}_{P}^2 \times 100$$
- **Verification:** ✅ **Correct.** At threshold ($\text{HR}_{\text{avg}} = \text{LTHR}$ or $P_{\text{avg}} = \text{FTP}$) for $t_{\min} = 60\text{ min}$, both $\text{hrTSS}$ and $\text{powerTSS}$ equal $100.0$, matching Coggan's TSS definition. Using $P_{\text{avg}}$ as a proxy for Normalized Power ($\text{NP}$) is a conservative lower bound by Jensen's inequality ($\text{NP} = \left(\frac{1}{T}\int P(t)^4\,dt\right)^{1/4} \ge P_{\text{avg}}$) when 1 Hz power streams are unavailable.

#### 1.3 Strength Stress Score ([`server/services/trainingLoad/stressScores.ts:57-112`](../server/services/trainingLoad/stressScores.ts#L57-L112))
- **Formula:**
  $$\text{StrengthStress} = \frac{\text{Tonnage}_{\text{eff}}}{100} \times \operatorname{round}\!\left(1.18^{\max(0, \text{RPE} - 6)}, 3\right) \times \max(0.4, M_{\text{axial}}) \times \max(0.6, M_{\text{eccentric}})$$
  where unweighted bodyweight reps use $\text{Tonnage}_{\text{eff}} = \text{reps} \times 20 \times \operatorname{clamp}\!\left(\frac{m_{\text{bw}}}{75}, 0.5, 2.0\right)$.
- **Verification:** ⚠️ **Partially Flawed (see M-NEW-1).** The exponential RPE multiplier ($1.18^{\text{RPE}-6}$ for $\text{RPE} > 6$) and biomechanical modifiers are well-calibrated, and unweighted reps scale with athlete bodyweight. However, weighted distance sets (`weight > 0 && distance > 0 && reps === 0`) are excluded by `isStrengthSet` and ignore `weight` in `calculateStrengthStressScore`.

#### 1.4 Bias-Corrected EWMA, ACWR, TSB & Foster Monotony ([`server/services/trainingLoad/loadDynamics.ts`](../server/services/trainingLoad/loadDynamics.ts))
- **Formulas:**
  - Decay constants:
    $$\lambda_{\text{acute}} = \frac{2}{7 + 1} = 0.25, \qquad \lambda_{\text{chronic}} = \frac{2}{28 + 1} = \frac{2}{29} \approx 0.0689655$$
  - Bias-corrected recursive filter ($t \ge 1$ days since first logged workout):
    $$S_t = \lambda x_t + (1 - \lambda) S_{t-1}, \qquad W_t = \lambda + (1 - \lambda) W_{t-1} = 1 - (1 - \lambda)^t$$
    $$\text{EWMA}_t = \frac{S_t}{W_t} = \frac{\sum_{k=0}^{t-1} \lambda (1-\lambda)^k x_{t-k}}{\sum_{k=0}^{t-1} \lambda (1-\lambda)^k}$$
  - Acute:Chronic Workload Ratio & Training Stress Balance (gated at $t \ge 14$ days and $\ge 56$-day fetch warmup):
    $$\text{ACWR}_t = \frac{\text{EWMA}_{\text{acute}, t}}{\text{EWMA}_{\text{chronic}, t}} \quad (\text{when } \text{EWMA}_{\text{chronic}, t} \ge 15), \qquad \text{TSB}_t = \text{EWMA}_{\text{chronic}, t} - \text{EWMA}_{\text{acute}, t}$$
  - Foster's Training Monotony & Strain (over a 7-day window $x_1, \dots, x_7$):
    $$\mu = \frac{1}{7}\sum_{i=1}^7 x_i, \qquad s = \sqrt{\frac{1}{6}\sum_{i=1}^7 (x_i - \mu)^2}$$
    $$\text{Monotony} = \begin{cases} \text{null} & \text{if } s = 0 \text{ and } \mu = 0 \\ 10.0 & \text{if } s = 0 \text{ and } \mu > 0 \\ \frac{\mu}{s} & \text{if } s > 0 \end{cases}, \qquad \text{Strain} = \left(\sum_{i=1}^7 x_i\right) \times \text{Monotony}$$
- **Verification:** ✅ **Mathematically Exact.** The finite-horizon normalization $W_t = 1 - (1-\lambda)^t$ guarantees the weights sum to $1$ at every day $t$, eliminating zero-initialization drag while converging to the standard infinite-impulse-response EWMA as $t \to \infty$.

#### 1.5 Uncoupled Body-System Load ([`server/services/trainingLoad/bodySystemLoad.ts`](../server/services/trainingLoad/bodySystemLoad.ts))
- **Formulas:**
  - Session sRPE load: $L_{\text{session}} = t_{\min} \times \text{RPE}$.
  - Time-weighted distribution across 5 systems $s \in \{\text{cardio}, \text{lowerBody}, \text{upperPull}, \text{upperPush}, \text{core}\}$:
    $$\bar{w}_s = \frac{\sum_i t_i w_{i, s}}{\sum_i t_i}, \qquad L_s = L_{\text{session}} \times \bar{w}_s$$
  - Uncoupled ACWR:
    $$\text{ACWR}_{\text{uncoupled}, s} = \frac{A_s}{\operatorname{round}\!\left(\frac{1}{k}\sum_{j=1}^k C_{s, j}\right)}, \quad k \in \{2, 3, 4\} \text{ prior full 7-day blocks}$$
- **Verification:** ✅ **Correct.** Using the *uncoupled* chronic baseline (excluding the current acute 7-day block $A_s$ from the denominator) follows Windt & Gabbett (2019) to avoid mathematical coupling where $A / \frac{A + C_1 + C_2 + C_3}{4}$ is bounded above by $4.0$.

---

### Domain 2: Strength Progression, Epley 1RM & Periodization Engine

#### 2.1 Epley 1RM & RIR-Adjusted Inverse Epley ([`server/services/workoutEngine/loadMath.ts`](../server/services/workoutEngine/loadMath.ts), [`shared/progression.ts`](../shared/progression.ts))
- **Formulas:**
  - **Forward Epley (`setEstimate`):**
    $$\text{e1RM} = w \cdot \left(1 + \frac{r + \text{RIR}}{30}\right), \qquad \text{where } r \in [1, 10],\; \text{RIR} = \begin{cases} 0 & \text{if } r < r_{\text{planned}} \\ 2 & \text{otherwise} \end{cases}$$
  - **Inverse Epley (`loadForReps`):**
    $$\text{RIR}(\text{RPE}) = \max(0, 10 - \text{RPE}), \qquad w(r, \text{RPE}) = \frac{\text{e1RM}}{1 + \frac{r + \text{RIR}(\text{RPE})}{30}}$$
  - **Implied RPE (`impliedRpe`):**
    $$\text{RPE}(w, r) = 10 - \left(30\left(\frac{\text{e1RM}}{w} - 1\right) - r\right)$$
- **Verification:** ✅ **Exact Algebraic Inverse.** Substituting $w(r, \text{RPE})$ into $\text{RPE}(w, r)$ for $\text{RPE} \le 10$ yields:
  $$10 - \left(30\left(1 + \frac{r + 10 - \text{RPE}}{30} - 1\right) - r\right) = 10 - (10 - \text{RPE}) = \text{RPE}$$
  Rounding is applied only at the display/prescription edge (`roundLoad`: nearest $2.5\text{ kg}$ for barbell lifts, $2.0\text{ kg}$ for dumbbells/kettlebells; `roundStoredWeight`: nearest $0.5\text{ kg}$ or $1\text{ lb}$).

#### 2.2 Autoregulated Adaptation Rules ([`server/services/workoutEngine/adaptation.ts`](../server/services/workoutEngine/adaptation.ts))
- **Formulas:**
  - **Surplus raise:** When realized best $\text{e1RM}$ exceeds planned $\text{e1RM}$ by $\ge 2\%$, upcoming sets of that lift within 21 days scale by $\min(1.05, \text{surplus})$, measured against `startWeights` so multiple logs in a single pass never compound raises (`C14`).
  - **Easy-session step:** Completed prescription at session $\text{RPE} \le 6$ raises upcoming sets by $+2.5\%$.
  - **Repeat / Deload:** Falling short once holds at the prescribed weight (`equivalentLoad`); missing the exact same prescription twice deloads by $-10\%$ and resumes at $+2.5\%/\text{wk}$.
  - **Detraining ease-in:** After a gap $\ge \max(14\text{ days}, 2 \times \text{medianGap})$, reduces load by $2.5\%$ per week beyond 14 days, capped at $-10\%$.
- **Verification:** ✅ **Mathematically Sound.**

---

### Domain 3: Running Physiology, Jack Daniels VDOT & MAF 180

#### 3.1 Jack Daniels & Jimmy Gilbert VDOT Model ([`server/services/workoutEngine/running.ts`](../server/services/workoutEngine/running.ts))
- **Formulas:**
  - Oxygen cost of running at velocity $v$ ($\text{m/min}$):
    $$\text{VO}_2(v) = -4.60 + 0.182258\,v + 0.000104\,v^2$$
  - Sustainable fraction of $\text{VO}_{2\max}$ over duration $t$ ($\text{min}$):
    $$f(t) = 0.8 + 0.1894393\,e^{-0.012778\,t} + 0.2989558\,e^{-0.1932605\,t}$$
  - Effective $\text{VO}_{2\max}$ ($\text{VDOT}$):
    $$\text{VDOT} = \frac{\text{VO}_2(v)}{f(t)}, \qquad \text{where } v = \frac{1000 \cdot d_{\text{km}}}{t_{\min}}$$
  - Inverse velocity solver (`paceAtFraction`) for target intensity fraction $\phi \in \{0.65, 0.79, 0.88, 0.975, 1.07\}$:
    $$0.000104\,v^2 + 0.182258\,v - (\text{VDOT}\cdot\phi + 4.60) = 0$$
    $$v = \frac{-0.182258 + \sqrt{0.182258^2 + 4(0.000104)(\text{VDOT}\cdot\phi + 4.60)}}{2(0.000104)}, \qquad \text{pace}_{\text{s/km}} = \frac{60000}{v}$$
- **Verification:** ✅ **Exact.** Every coefficient matches the published Daniels & Gilbert (1979) equations to full precision, and the quadratic root strictly selects the positive physical velocity $v > 0$.

#### 3.2 Maffetone MAF 180 & OLS Pace Trend ([`shared/maf.ts`](../shared/maf.ts), [`server/services/ai/mafTrend.ts`](../server/services/ai/mafTrend.ts))
- **Formulas:**
  - $\text{MAF HR} = \operatorname{clamp}(180 - \text{age} + \Delta_{\text{mod}}, 100, 175)$ (or flat $165$ for $\text{age} \le 16$), with aerobic window $[\text{MAF} - 10, \text{MAF}]$.
  - Ordinary Least Squares (OLS) regression of pace $y_i$ ($\text{s/km}$) on elapsed days $t_i$:
    $$\beta_1 = \frac{\sum_{i=1}^n (t_i - \bar{t})(y_i - \bar{y})}{\sum_{i=1}^n (t_i - \bar{t})^2} \quad (\text{s/km per day}), \qquad \text{slope}_{\text{wk}} = 7\,\beta_1$$
- **Verification:** ✅ **Exact.** Mean-centering $(t_i - \bar{t})$ avoids floating-point cancellation in the sum of squares, and negative slopes ($\text{slope}_{\text{wk}} < -1.0\text{ s/km/wk}$) are properly classified as `"improving"` (faster pace at aerobic HR).

---

### Domain 4: HYROX Race Prediction & Empirical CDF Ranking

#### 4.1 Riegel Power-Law Station Projection & Fatigue Multipliers ([`server/services/racePrediction/featureBuilder.ts`](../server/services/racePrediction/featureBuilder.ts))
- **Formulas:**
  - Partial-effort distance/rep projection (gated to $\frac{D_{\text{logged}}}{D_{\text{race}}} \in [0.5, 2.0]$):
    $$T_{\text{projected}} = T_{\text{logged}} \cdot \left(\frac{D_{\text{race}}}{D_{\text{logged}}}\right)^\alpha, \qquad \alpha = \begin{cases} 1.06 & \text{runs, SkiErg, Row, Wall Balls} \\ 1.10 & \text{Sled Push/Pull, Burpees, Carry, Lunges} \end{cases}$$
  - Load adjustment for weighted stations:
    $$\text{LoadFactor} = \operatorname{clamp}\!\left(1 + 0.25\left(1 - \frac{W_{\text{logged}}}{W_{\text{spec}}}\right),\; 0.85,\; 1.25\right)$$
  - Race-day compromised fatigue multipliers (clamped to $[0.8, 1.5] \times T_{\text{benchmark}}$):
    $$T_{\text{run}, k} = \max\!\left(\operatorname{round}\!\left(B_{\text{run}, k} \cdot \operatorname{clamp}\!\left(\frac{1.15 \cdot M_{\text{run}}}{\bar{B}_{\text{run}}}, 0.8, 1.5\right)\right), F_{\text{run}}\right)$$
    $$T_{\text{station}} = \max\!\left(\operatorname{round}\!\left(\operatorname{clamp}\!\left(1.10 \cdot \text{LoadAdjust}(M_{\text{station}}, \text{loadRatio}),\; 0.8\,B_{\text{station}},\; 1.5\,B_{\text{station}}\right)\right), F_{\text{station}}\right)$$
- **Verification:** ⚠️ **Sound Power-Law & Fatigue Structure, but `maxLoad` is decoupled from timed sets (see M-NEW-5).**

#### 4.2 Piecewise-Linear Percentile Ranking ([`server/services/racePrediction/ranking.ts`](../server/services/racePrediction/ranking.ts))
- **Formula:**
  Given the 99-element empirical quantile array $Q = [q_1, q_2, \dots, q_{99}]$ (where $q_k$ is the $k$-th percentile finish time in seconds, $q_1 < q_2 < \dots < q_{99}$):
  $$\text{pct}(x) = i + \frac{x - q_i}{q_{i+1} - q_i} \quad \text{for } q_i < x \le q_{i+1}, \qquad \text{fasterThanPct} = \operatorname{clamp}(\operatorname{round}(100 - \text{pct}(x)), 1, 99)$$
- **Verification:** ✅ **Exact.** Because array index $k - 1$ holds $q_k$, when $x = q_{50}$ (`arr[49]`), the loop stops at `i = 49` (`lo = arr[48]`, `hi = arr[49]`), giving `frac = 1`, `pct = 49 + 1 = 50`, and `fasterThanPct = 100 - 50 = 50%`. There is no off-by-one bias at the median or quartiles.

---

### Domain 5: Session Grading & Telemetry Signal Processing

#### 5.1 Irregular Stream Downsampling ([`server/services/sessionGrades/downsample.ts`](../server/services/sessionGrades/downsample.ts))
- **Formula:**
  For irregular time steps $\Delta t_i = t_i - t_{i-1}$ with $0 < \Delta t_i \le 20\text{ s}$ inside 15-second bucket $B_k$:
  $$\overline{\text{HR}}_k = \operatorname{round}\!\left(\frac{\sum_{i \in B_k} \text{HR}_i \Delta t_i}{\sum_{i \in B_k} \Delta t_i}\right), \qquad \text{Pace}_k = \operatorname{round}\!\left(\frac{\sum_{i \in B_k} \Delta t_i}{\sum_{i \in B_k} \Delta d_i} \times 1000\right)$$
- **Verification:** ✅ **Exact.** Weighting by $\Delta t_i$ prevents variable GPS sampling rates (e.g., Strava "smart recording") from biasing average heart rate or pace, and rejecting $\Delta t_i > 20\text{ s}$ prevents coffee/traffic stops from corrupting bucket paces.

#### 5.2 Otsu's Method for Interval Work/Rest Segmentation ([`server/services/sessionGrades/workSegments.ts`](../server/services/sessionGrades/workSegments.ts))
- **Formula:**
  After applying a 3-bucket rolling median filter to pace values sorted in ascending order $p_{(1)} \le \dots \le p_{(N)}$, `otsuCut` finds the split index $k \in \{1, \dots, N-1\}$ maximizing:
  $$\sigma_B^2(k) = k(N - k)(\mu_{\text{high}}(k) - \mu_{\text{low}}(k))^2, \qquad \text{subject to } \mu_{\text{high}}(k) - \mu_{\text{low}}(k) \ge 35\text{ s/km}$$
- **Verification:** ✅ **Exact.** Since $N^2$ is constant across $k$, maximizing $k(N-k)(\mu_1 - \mu_0)^2$ is mathematically identical to maximizing Otsu's between-class variance $\omega_0 \omega_1 (\mu_1 - \mu_0)^2 = \frac{k}{N}\frac{N-k}{N}(\mu_1 - \mu_0)^2$.

#### 5.3 Aerobic Decoupling ($\text{Pa:Hr}$) ([`server/services/sessionGrades/gradeThreshold.ts`](../server/services/sessionGrades/gradeThreshold.ts))
- **Formula:**
  $$\text{EF}_{\text{half}} = \frac{v_{\text{m/s}}}{\overline{\text{HR}}} = \frac{1000 / \text{Pace}_{\text{s/km}}}{\overline{\text{HR}}}, \qquad \text{Decoupling (\%)} = \frac{\text{EF}_1 - \text{EF}_2}{\text{EF}_1} \times 100$$
- **Verification:** ✅ **Exact.** Matches Joe Friel / TrainingPeaks $\text{Pa:Hr}$ decoupling: when heart rate drifts upward at constant pace (or pace slows at constant HR) in the second half, $\text{EF}_2 < \text{EF}_1$ and decoupling is positive ($< 5\%$ = aerobic stability).

---

### Domain 6: Nutrition, Energy Balance & Carb Periodization

#### 6.1 Mifflin–St Jeor BMR, TDEE & Non-Double-Counted Energy Balance ([`shared/nutritionTargets.ts`](../shared/nutritionTargets.ts), [`shared/energyBalance.ts`](../shared/energyBalance.ts))
- **Formulas:**
  $$\text{BMR} = 10\,m_{\text{kg}} + 6.25\,h_{\text{cm}} - 5\,\text{age} + s, \qquad s = \begin{cases} +5 & \text{male} \\ -161 & \text{female} \\ -78 & \text{null / unspecified} \end{cases}$$
  $$\Delta E_{\text{goal}} = \pm \frac{|\dot{m}_{\text{kg/wk}}| \times 7700\text{ kcal/kg}}{7\text{ days/wk}} = \pm 1100\,|\dot{m}_{\text{kg/wk}}|$$
  $$\text{EnergyOut} = \begin{cases} \operatorname{round}(1.2\,\text{BMR} + E_{\text{measured}}) & \text{if } E_{\text{measured}} > 0 \\ \operatorname{round}(1.2\,\text{BMR}) & \text{if } E_{\text{measured}} = \text{null} \text{ and } N_{\text{sessions}} = 0 \\ \operatorname{round}(M_{\text{activity}}\,\text{BMR}) & \text{otherwise} \end{cases}$$
- **Verification:** ✅ **Exact** (aside from the zero-sum component scaling edge case in `effectiveTargetWindowed`, **M-NEW-3**). Using $1.2 \times \text{BMR}$ (sedentary NEAT + thermic effect of food) plus measured active workout calories prevents double-counting the exercise component baked into $M_{\text{activity}} \in [1.375, 1.9]$.

#### 6.2 Food vs. Mechanical Kilojoule Conversions ([`server/services/nutrition/offClient.ts:35-36`](../server/services/nutrition/offClient.ts#L35-L36), [`server/services/stravaMapper.ts:24-50`](../server/services/stravaMapper.ts#L24-L50))
- **Formulas:**
  - **Food label energy (`offClient.ts`):** $\text{kcal} = 0.239 \times \text{kJ}_{\text{food}}$
  - **Power-meter mechanical work (`stravaMapper.ts`):**
    $$\text{kcal} = \frac{\text{kJ}_{\text{mechanical}}}{\eta_{\text{cycling}}} \times 0.239 = \frac{0.239}{0.24}\,\text{kJ}_{\text{mechanical}} \approx 0.9958\,\text{kJ}_{\text{mechanical}}$$
- **Verification:** ✅ **Physiologically & Thermodynamically Exact.**

---

### Domain 7: Unit Conversions, Pooled Ratios & Analytics Rollups

#### 7.1 Canonical Conversion Constants ([`shared/units.ts`](../shared/units.ts), [`shared/unitConversion.ts`](../shared/unitConversion.ts), [`server/services/nutrition/utils.ts`](../server/services/nutrition/utils.ts))
- $1\text{ international mile} = 1609.344\text{ m}$ (exact by 1959 international yard and pound agreement), with $\text{KM\_TO\_MILES} = \frac{1000}{1609.344}$ derived from the single constant.
- $1\text{ avoirdupois ounce} = 28.349523125\text{ g}$ (exact) and $1\text{ avoirdupois pound} = 453.59237\text{ g}$ (exact, in `usdaClient.ts`).
- $1\text{ inch} = 2.54\text{ cm}$ (exact).
- **Verification:** ✅ **Exact.** Note that `KG_TO_LBS = 2.20462` and `M_TO_FT = 3.28084` are standard 6-significant-figure approximations (relative error $1.2 \times 10^{-6}$ and $1.9 \times 10^{-7}$ respectively), which are well within display rounding tolerances ($0.5\text{ kg}$, $1\text{ lb}$, $1\text{ ft}$).

#### 7.2 Pooled Ratios & Weighted Means ([`shared/ratio.ts`](../shared/ratio.ts), [`server/services/analyticsService.ts`](../server/services/analyticsService.ts))
- **Formulas:**
  - Weekly RPE rollup in `computeOverviewStats`:
    $$\overline{\text{RPE}} = \frac{\sum_{w} \overline{\text{RPE}}_w \cdot n_{\text{rpe}, w}}{\sum_{w} n_{\text{rpe}, w}}$$
  - Average duration over workouts with recorded duration:
    $$\overline{D} = \frac{\sum_{w} D_w}{\sum_{w} n_{\text{dur}, w}}$$
  - Average workouts per week over selected period of $P$ days:
    $$\overline{W}_{\text{wk}} = \frac{N_{\text{workouts}}}{P / 7}$$
- **Verification:** ✅ **Correct.** Note a minor precision detail in [`computeOverviewStats`](../server/services/analyticsService.ts#L871-L874): `w.avgRpe` is rounded to 1 decimal place per week (`Math.round((w.rpeSum / w.rpeCount) * 10) / 10`), so reconstructing `w.avgRpe * w.rpeCount` can differ from the raw `w.rpeSum` by at most $\pm 0.05 \times n_{\text{rpe}, w}$ (bounded by $\pm 0.05\text{ RPE}$ on the final weighted mean).
