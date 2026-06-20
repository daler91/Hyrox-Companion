
# Analytics and Training Formulas Audit Report

This report provides an audit of the mathematical formulas, algorithms, and heuristics used in the application's analytics and training load features. The evaluation assesses mathematical correctness and alignment with standard sports science principles.

## 1. Acute:Chronic Workload Ratio (ACWR)

**Implementation File:** `server/services/trainingLoadService.ts`
**Functions:** `applyAcwr`, `resolveAcwrZone`, `sumUtss`

**Mathematical Implementation:**
*   **Acute Load:** 7-day rolling average of daily UTSS (Universal Training Stress Score). Calculated as `sumUtss(days, date, 7) / 7`.
*   **Chronic Load:** 28-day rolling average of daily UTSS. Calculated as `sumUtss(days, date, 28) / 28`.
*   **Ratio:** `acuteAvg / chronicAvg`.
*   **Zones:**
    *   `< 0.8`: Undertraining
    *   `0.8 - 1.3`: Sweet Spot
    *   `1.3 - 1.5`: Yellow (Caution)
    *   `> 1.5`: Danger

**Audit Findings:**
*   **Correctness:** The implementation correctly computes the rolling averages as defined. Missing days are implicitly treated as `0` UTSS in the `days` map, which is correct for modeling physical load—rest days should pull the average down.
*   **Principles:** The zones (0.8 - 1.3 sweet spot, > 1.5 danger) perfectly align with Tim Gabbett's canonical ACWR model for injury prevention.
*   **Edge Case Handling (The "New Athlete" Problem):** The code explicitly handles a known mathematical flaw in standard ACWR: calculating the ratio for new athletes. If a user only has 7 days of data, their 28-day chronic average is artificially depressed by 21 days of trailing zeros (which aren't true rest, just unlogged history), causing the ACWR to spike (e.g., ~4.0) and falsely flag them in the "danger" zone. The codebase mitigates this by enforcing `ACWR_MIN_HISTORY_DAYS = 14`. While 28 days would be mathematically pure, 14 days is a pragmatic product compromise that allows the feature to activate sooner while preventing extreme denominator artifacts.
*   **Limitation:** The calculation uses simple rolling averages (Rolling Averages - RA) rather than Exponentially Weighted Moving Averages (EWMA). Recent sports science literature suggests EWMA is superior because it gives greater weight to more recent workouts, modeling fitness decay more accurately. However, RA is mathematically sound according to the original, standard Gabbett model.


## 2. Training Stress Scores & Load Vectors

**Implementation File:** `server/services/trainingLoadService.ts`
**Functions:** `calculateStrengthStressScore`, `calculateCardioStressScore`, `inferCardioIntensityFactor`, `rpeFactor`

**Mathematical Implementation:**
*   **Strength Stress Score:**
    *   `weightedTonnage = weight * max(reps, 1)`. Fallbacks: bodyweight reps `* 20`, distance `* 0.08`.
    *   `modifier = max(0.4, axialLoadModifier) * max(0.6, eccentricRiskModifier)`.
    *   `rpeFactor = Math.pow(1.18, max(0, rpe - 6))`. Defaults to `1` if no RPE.
    *   Score: `(weightedTonnage / 100) * rpeFactor * modifier`.
*   **Cardio Stress Score:**
    *   `duration * inferCardioIntensityFactor`.
    *   Intensity Factor via RPE: `0.6 + Math.pow(rpe / 10, 2) * 2`.
    *   Intensity Factor heuristics (fallback): `2.3` (high risk sprints), `2.1` (sprints/intervals), `1.35` (long/downhill), `0.9` (recovery/zone 2), `1.1` (default).

**Audit Findings:**
*   **Correctness (Strength):** The formula logically attempts to normalize volume-load. The `rpeFactor` is an exponential curve `1.18^(RPE - 6)`, which correctly models the non-linear relationship between proximity to failure and physiological stress (e.g., an RPE 9 set is significantly more taxing than RPE 7). The bounds on modifiers (`max(0.4)`, `max(0.6)`) prevent scores from zeroing out entirely for isolation exercises.
*   **Correctness (Cardio):** The `duration * intensity` formulation mirrors established models like Training Stress Score (TSS) or TRIMP. The RPE mapping `0.6 + 2 * (RPE/10)^2` produces a curve from `0.6` (RPE 0) to `2.6` (RPE 10), which scales linearly against duration, creating an exponential reward for intensity.
*   **Heuristic Fallbacks:** The keyword-based fallbacks for cardio intensity (`inferCardioIntensityFactor`) are coarse but structurally sound. As the comment notes, it has "known blind spots (no negation handling — 'not easy' still matches 'easy')", which is a recognized limitation but acceptable for unstructured data processing.
*   **Vector Damping:** Cardio sets apply `0.25` damping to their stress when accumulating into Load Vectors (e.g., posterior chain, anterior chain). This correctly recognizes that while running duration adds systemic cardiovascular stress, the localized tissue load per minute is lower than heavy strength training, requiring normalization before vectors are compared.


## 3. Estimated One-Rep Max (1RM)

**Implementation File:** `server/services/analyticsService.ts`
**Functions:** `estimateOneRepMax`, `isE1RMCandidate`

**Mathematical Implementation:**
*   **Formula:** `weight * (1 + reps / 30)` rounded to 1 decimal place.
*   **Constraints:** Only applied to sets where `2 <= reps <= 10`.

**Audit Findings:**
*   **Correctness:** This is the exact implementation of the **Epley formula**, one of the most widely accepted formulas for estimating 1RM.
*   **Principles:** The constraints applied in `isE1RMCandidate` demonstrate strong alignment with sports science principles. The Epley formula degrades in accuracy exponentially as reps increase beyond 10, because sets of 15-20+ represent muscular endurance rather than strength. Capping the calculation at 10 reps is a mathematically sound safeguard against wildly inaccurate estimations (e.g., estimating a 500lb squat from an empty bar walked for 100 reps).
*   **Exclusion of Singles:** Explicitly excluding `reps === 1` is also correct, as a 1-rep set is an actual observation, not an estimation, and passing `1` into the formula would erroneously inflate the actual weight by ~3.3%.


## 4. Coach Influence / Similarity Metrics

**Implementation File:** `script/coach-influence/metrics.ts`
**Functions:** `jaccard`, `targetOverlap`, `suggestionCountDelta`, `actionShift`, `priorityShift`

**Mathematical Implementation:**
*   **Jaccard Index:** `intersection / union`.
*   **Target Overlap:** `1 - jaccard(baselineTargets, variantTargets)`.
*   **Count/Ratio Deltas:** Simple absolute differences between means and ratios.
*   **Priority Shift:** Mean Absolute Error (MAE) across high/medium/low ratio vectors divided by 2.

**Audit Findings:**
*   **Correctness:** The Jaccard Index is correctly implemented `inter / (a.size + b.size - inter)`. It safely handles empty sets by returning `1` (complete similarity).
*   **Metric Mapping:** `targetOverlap` computes divergence by subtracting Jaccard from 1. This correctly maps similarity (Jaccard) into a divergence metric (0 = no change, 1 = complete change).
*   **Vector Distance:** `priorityShift` compares two probability distributions (high/medium/low ratios). Summing the absolute differences and dividing by 2 is exactly the formula for Total Variation Distance (TVD) for discrete probability measures. This is mathematically correct and bounded `[0, 1]`.
*   **Text Analysis limitation:** The TF-IDF implementation (`tfVector`, `cosineSimilarity`) relies on a basic tokenization using a static stopword list. While mathematically functional for cosine similarity `dot(a, b) / (mag(a) * mag(b))`, it strips out negations ("not", "no") due to the stopword list, meaning "do not run" and "run" could mathematically evaluate as highly similar. For a test harness, this is acceptable, but could be a blind spot for actual sentiment analysis.


## 5. General Analytics Algorithms

**Implementation Files:** `client/src/lib/statsUtils.ts`, `client/src/components/analytics/mafTrend.helpers.ts`
**Functions:** `calculateStreak`, `calculateStats`, `buildComplianceTrendData`

**Audit Findings:**
*   **Streak Calculation (`calculateStreak`):** The logic iterates backward day-by-day to find consecutive logs. It correctly checks if the set contains `todayStr` or `yesterdayStr` to maintain an active streak. If neither exists, the streak is 0. This is the standard, correct definition of a daily activity streak.
*   **Timezone Handling:** The streak logic explicitly compares against `toISODateString(today)` locally, avoiding the classic bug where UTC day rollovers prematurely break a user's streak based on their timezone.
*   **Sorting Optimizations:** Throughout the analytics helpers (e.g., `buildComplianceTrendData`, `calculateTrainingLoad`), the code uses native string comparisons (`a.date < b.date`) for `YYYY-MM-DD` formatted dates instead of `Date.parse` or `new Date()`. This is mathematically safe because ISO 8601 date strings sort lexicographically perfectly aligned with chronological order, preventing unnecessary O(N log N) memory overhead.
*   **O(N) Traversal:** `calculateStats` demonstrates optimization by traversing the timeline exactly once to compute "Workouts This Week", "Completion Rate", and "Planned Upcoming", reducing overhead compared to multiple `.filter().length` passes.

## Conclusion

The analytics and training load formulas audited in this codebase are mathematically sound and adhere closely to recognized sports science principles. The implementations show a high degree of defensive programming, particularly around:
1.  Bounding estimations (e.g., Epley formula rep caps).
2.  Normalizing intensity scales (exponential RPE factors).
3.  Protecting aggregate metrics from data sparseness (e.g., gating ACWR ratios behind 14-day history).

No significant mathematical flaws or conceptual deviations from established models were detected during this audit.

## 6. Missing Principles & Opportunities for Improvement

While the current formulas are mathematically sound implementations of their respective base models (e.g., standard Rolling Average Gabbett ACWR, Epley 1RM), the codebase lacks several advanced sports science principles that are considered modern industry standards:

### 1. Exponentially Weighted Moving Averages (EWMA)
*   **Current State:** The ACWR calculation uses simple Rolling Averages (RA). In a 28-day RA, a massive workload on Day 1 carries the exact same mathematical weight as a massive workload on Day 28. On Day 29, the Day 1 workload instantly drops to zero.
*   **Missing Principle:** Physiologically, fatigue and fitness decay exponentially over time. A workout performed yesterday impacts you more today than a workout performed three weeks ago.
*   **Recommendation:** Upgrade the ACWR model to use EWMA. EWMA assigns exponentially decreasing mathematical weights to older data points. This smooths out artificial "cliffs" when large loads drop out of the rolling window and aligns closer to true physiological decay models (like Banister's impulse-response model).

### 2. Training Monotony and Strain (Foster's Model)
*   **Current State:** The codebase calculates `UTSS` and aggregates it into averages (Acute/Chronic), but it does not measure the *variance* of the load day-to-day.
*   **Missing Principle:** Training Monotony (Carl Foster, 1998). High workloads are well tolerated if they are interspersed with proper recovery (hard/easy days). The same workload achieved by doing the exact same moderate session every single day leads to overtraining and illness.
*   **Recommendation:** Implement Monotony and Strain.
    *   `Monotony = (Average Daily UTSS over 7 days) / (Standard Deviation of Daily UTSS over 7 days)`
    *   `Strain = Total Weekly UTSS * Monotony`
    *   A Monotony score > 2.0 is a strong mathematical predictor of overtraining, which the current ACWR model might miss if the total average load appears "safe".

### 3. Training Stress Balance (TSB) / Form
*   **Current State:** The application computes Chronic Load (Fitness) and Acute Load (Fatigue) and divides them (`Acute / Chronic`) to assess injury risk.
*   **Missing Principle:** The application does not calculate *Training Stress Balance* (`Chronic - Acute`). TSB is standard in platforms like TrainingPeaks. While the ratio (ACWR) is best for injury prevention, the absolute difference (TSB) is critical for performance peaking and tapering. A positive TSB indicates the athlete is rested ("on form"), while a deeply negative TSB indicates heavy fatigue.
*   **Recommendation:** Introduce TSB (`Chronic - Acute`) as a metric for race prediction and event tapering.

### 4. Objective Physiological Load vs. Subjective RPE (TRIMP/TSS)
*   **Current State:** Cardio stress relies heavily on `duration * Intensity Factor`, where Intensity Factor is derived either from RPE or coarse textual heuristics (e.g., matching the word "sprint").
*   **Missing Principle:** The codebase defines HR fields (`avgHeartrate`, `maxHeartrate`, `avgWatts` on the `WorkoutLog` schema) but does not utilize them mathematically for load calculation. Subjective RPE is valuable, but objective metrics (HR, Power) are the gold standard for endurance load.
*   **Recommendation:** Implement TRIMP (Training Impulse) using heart rate data, or TSS (Training Stress Score) using power data, when available.
    *   **TRIMP (Banister):** `Duration * (Delta HR Ratio) * e^(b * Delta HR Ratio)`
    *   This provides a continuous, exponential, and objective measure of internal physiological stress, rather than relying on textual fallbacks when a user forgets to log an RPE.
