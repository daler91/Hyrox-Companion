package com.fitai.coach.core.exercises

import com.fitai.coach.core.js.jsRound
import kotlin.math.floor

/*
 * Session-to-session progression for a strength exercise, ported from
 * shared/progression.ts: the "Next" chip, which must equal the target the
 * workout engine writes into the plan. Every expression keeps the
 * TypeScript's operation order, so the doubles match bit for bit; rounding is
 * `jsRound` (Math.round).
 */

/**
 * `ProgressionSet`: the fields of a logged set the rules read, weights in the
 * athlete's unit. Null stands for both null and undefined in the TypeScript.
 */
public data class ProgressionSet(
    val reps: Int? = null,
    val weight: Double? = null,
    val plannedReps: Int? = null,
    val plannedWeight: Double? = null,
)

/** `NextTarget`: a suggested prescription for the next session of an exercise. */
public data class NextTarget(
    /** Same set count as last time: the suggestion changes intensity, not volume. */
    val setCount: Int,
    val reps: Int,
    val weight: Double,
    /** The single thing that moved versus last session. */
    val step: NextTargetStep,
)

/** `NextTarget["step"]`, discriminated by `field` in the TypeScript. */
public sealed interface NextTargetStep {
    /** `{ field: "reps", amount: 1 }`. */
    public data object Reps : NextTargetStep {
        public val amount: Int get() = 1
    }

    /** `{ field: "weight", amount }`: the weight went up by [amount]. */
    public data class Weight(val amount: Double) : NextTargetStep

    /** `{ field: "repeat" }`: last session's prescription was missed, so go again. */
    public data object Repeat : NextTargetStep

    /** `{ field: "deload", amount }`: missed twice, so the weight came down by [amount]. */
    public data class Deload(val amount: Double) : NextTargetStep
}

/** The prescription [unmetPrescription] returns. */
public data class Prescription(val reps: Int, val weight: Double)

// Epley is only trusted for 2–10 rep strength sets.
private const val EPLEY_MIN_REPS = 2
private const val EPLEY_MAX_REPS = 10

// Past this fraction of the estimated 1RM a jump is a programme change, not an overload.
private const val MAX_E1RM_GAIN_FRACTION = 0.1

// A deload takes 10% off the weight missed twice, floored to a real plate.
private const val DELOAD_FRACTION = 0.1

/** `WeightSteps`: the implement's own step, and the half step plate-loaded work can fall back to. */
private class WeightSteps(val standard: Double, val small: Double?)

/** Port of `weightSteps`. Any unit but "kg" is pounds; "" (no exercise) means barbell plates. */
private fun weightSteps(unit: String, exerciseName: String): WeightSteps {
    val standard = loadIncrement(exerciseName, if (unit == "kg") "kg" else "lbs")
    val implement = implementFor(exerciseName)
    val plateLoaded = implement == Implement.Barbell || implement == Implement.Bodyweight
    return WeightSteps(standard, if (plateLoaded) standard / 2 else null)
}

/** Port of `stepsToTry`: the implement's own step first. */
private fun stepsToTry(steps: WeightSteps): List<Double> =
    if (steps.small == null) listOf(steps.standard) else listOf(steps.standard, steps.small)

/** Port of `epley`: estimated one-rep max, `weight * (1 + reps / 30)`. */
public fun epley(weight: Double, reps: Double): Double = weight * (1 + reps / 30)

/** Port of `roundWeight`: to two decimals with Math.round. */
private fun roundWeight(value: Double): Double = jsRound(value * 100) / 100

/** Port of `uniformValue`: the value every set shares, or null when they differ or it is missing. */
private inline fun uniformValue(sets: List<ProgressionSet>, read: (ProgressionSet) -> Double?): Double? {
    val first = sets.firstOrNull() ?: return null
    val value = read(first) ?: return null
    // Primitive doubles, so the comparison is IEEE like JS ===.
    return if (sets.all { set -> read(set).let { it != null && it == value } }) value else null
}

/**
 * Port of `suggestNextTarget`: the next target for a strength exercise,
 * progressed from its last session, or null when the maths has no footing.
 *
 * - A prescription missed in [lastSets] is repeated, or deloaded ~10% when
 *   [previousSets] (the session before last) missed the same one.
 * - Otherwise uniform sets of 2–10 reps progress by +1 rep or one implement
 *   step, whichever raises the Epley estimate less, within a 10% gain cap.
 *
 * @param category only "strength" gets a suggestion.
 * @param weightUnit "kg" for kilograms; any other value is pounds.
 * @param exerciseName the canonical exercise name, for its implement's steps;
 *   null or omitted means barbell plates. As in the TypeScript, a name
 *   inherited from Object.prototype ("constructor", …) gets barbell plates
 *   without the half step (see [implementFor]).
 */
public fun suggestNextTarget(
    lastSets: List<ProgressionSet>,
    category: String,
    weightUnit: String,
    previousSets: List<ProgressionSet>? = null,
    exerciseName: String? = null,
): NextTarget? {
    // The TypeScript defaults a missing name to ""; a null one also resolves to barbell plates there.
    val steps = weightSteps(weightUnit, exerciseName ?: "")
    if (category != "strength") return null

    // Before the uniformity gate: a missed last set (5/5/4) makes the logged reps vary.
    val unmet = unmetPrescription(lastSets)
    if (unmet != null) {
        // Missed twice at the same prescription (exact equality): back off instead of going again.
        val previousUnmet = previousSets?.let { unmetPrescription(it) }
        if (previousUnmet != null && previousUnmet.reps == unmet.reps && previousUnmet.weight == unmet.weight) {
            deloadFrom(lastSets.size, unmet, steps)?.let { return it }
        }
        return NextTarget(
            setCount = lastSets.size,
            reps = unmet.reps,
            weight = roundWeight(unmet.weight),
            step = NextTargetStep.Repeat,
        )
    }

    val weight = uniformValue(lastSets) { it.weight }
    val reps = uniformValue(lastSets) { it.reps?.toDouble() }
    if (weight == null || reps == null) return null
    if (weight <= 0 || reps < EPLEY_MIN_REPS || reps > EPLEY_MAX_REPS) return null

    return progressFrom(lastSets.size, weight, reps.toInt(), steps)
}

/**
 * Port of `unmetPrescription`: last session's prescription, when every set
 * carried the same one and at least one set fell short of it on reps or
 * weight (a missing logged value counts as 0). Null when nothing was
 * prescribed, the prescription varied, it was met, or its weight is not
 * positive.
 */
public fun unmetPrescription(sets: List<ProgressionSet>): Prescription? {
    var plannedReps: Int? = null
    var plannedWeight: Double? = null
    var fellShort = false

    for (set in sets) {
        val setReps = set.plannedReps ?: return null
        val setWeight = set.plannedWeight ?: return null
        val targetReps = plannedReps ?: setReps
        val targetWeight = plannedWeight ?: setWeight
        plannedReps = targetReps
        plannedWeight = targetWeight
        // A prescription that differs set to set is not one target to repeat.
        if (setReps != targetReps || setWeight != targetWeight) return null
        if ((set.reps ?: 0) < setReps || (set.weight ?: 0.0) < setWeight) fellShort = true
    }

    if (!fellShort || plannedReps == null || plannedWeight == null) return null
    if (plannedWeight <= 0) return null
    return Prescription(plannedReps, plannedWeight)
}

/**
 * Port of `deloadFrom`: 10% off the missed weight, floored to the plate step
 * (the half step only when the standard one floors to zero); null when even
 * that is zero, and the caller repeats.
 */
private fun deloadFrom(setCount: Int, missed: Prescription, steps: WeightSteps): NextTarget? {
    val reduced = missed.weight * (1 - DELOAD_FRACTION)
    for (grid in stepsToTry(steps)) {
        val floored = roundWeight(floor(reduced / grid) * grid)
        if (floored > 0) {
            return NextTarget(
                setCount = setCount,
                reps = missed.reps,
                weight = floored,
                step = NextTargetStep.Deload(roundWeight(missed.weight - floored)),
            )
        }
    }
    return null
}

/**
 * Port of `progressFrom`: +1 rep (worth `weight / 30`) or one step (worth
 * `step * (1 + reps / 30)`), whichever gains less; at 10 reps only a step,
 * and only one within the cap.
 */
private fun progressFrom(setCount: Int, weight: Double, reps: Int, steps: WeightSteps): NextTarget? {
    val cap = epley(weight, reps.toDouble()) * MAX_E1RM_GAIN_FRACTION

    val repsGain = if (reps < EPLEY_MAX_REPS) weight / 30 else null
    val weightGain = steps.standard * (1 + reps / 30.0)

    if (repsGain != null && repsGain < weightGain) {
        return NextTarget(setCount, reps + 1, weight, NextTargetStep.Reps)
    }

    // Standard step first, so the crossover above is untouched; the half step only once it is rejected.
    val step = stepsToTry(steps).firstOrNull { candidate -> candidate * (1 + reps / 30.0) <= cap } ?: return null

    return NextTarget(setCount, reps, roundWeight(weight + step), NextTargetStep.Weight(step))
}
