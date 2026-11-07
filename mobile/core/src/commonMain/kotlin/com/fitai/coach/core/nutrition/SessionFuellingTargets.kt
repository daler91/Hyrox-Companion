package com.fitai.coach.core.nutrition

import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.js.jsRound

/*
 * Port of shared/sessionFuellingTargets.ts: per-session fuelling targets from
 * duration, RPE and bodyweight. The fuelling panel recomputes them on every
 * stepper tap; the server returns the same calculation from
 * /session-fuelling/{workoutId}. Pinned by the
 * `sessionFuellingTargets.computeSessionFuellingTarget` fixtures, explanation included.
 */

/** `SessionFuellingTargetInput`. Each field is optional: null means unknown. */
public data class SessionFuellingTargetInput(
    /** Session duration in minutes. */
    val durationMin: Double? = null,
    /** Rate of perceived exertion, 1–10. */
    val rpe: Double? = null,
    /** Athlete bodyweight in kg; targets anchor to g/kg when it is set. */
    val bodyweightKg: Double? = null,
)

/**
 * `SessionFuellingTarget`. The gram figures are whole numbers (JS `Math.round`),
 * kept as [Double] like the TS numbers so extreme inputs give the same NaN or
 * Infinity. [reasonCodes] are the wire strings, in the order the TS pushes them.
 */
public data class SessionFuellingTarget(
    /** Carbs (g) in the pre-session window; 0 when none are needed. */
    val preCarbG: Double,
    /** Carbs (g) in the post-session recovery window. */
    val postCarbG: Double,
    /** Protein (g) in the post-session recovery window. */
    val postProteinG: Double,
    val reasonCodes: List<String>,
    val explanation: String,
)

// g/kg anchors at a moderate (~1h) session; scaled by intensity and duration.
private const val POST_PROTEIN_G_PER_KG = 0.3
private const val POST_PROTEIN_MIN_G = 20.0
private const val POST_PROTEIN_MAX_G = 40.0
private const val POST_CARB_BASE_G_PER_KG = 0.7
private const val PRE_CARB_BASE_G_PER_KG = 0.4

// Absolute fallbacks when bodyweight is unknown.
private const val DEFAULT_PRE_CARB_G = 30.0
private const val DEFAULT_POST_CARB_G = 60.0
private const val DEFAULT_POST_PROTEIN_G = 25.0

private const val DEFAULT_DURATION_MIN = 60.0

/** Port of the private `clamp`: `Math.min(hi, Math.max(lo, n))`, NaN in gives NaN out. */
private fun clamp(n: Double, lo: Double, hi: Double): Double = minOf(hi, maxOf(lo, n))

private data class Intensity(val factor: Double, val label: String, val assumed: Boolean)

/** Port of the private `intensityFactor`: RPE to a multiplier; null assumes moderate. NaN falls through to hard, as in JS. */
private fun intensityFactor(rpe: Double?): Intensity = when {
    rpe == null -> Intensity(factor = 1.0, label = "moderate", assumed = true)
    rpe <= 4.0 -> Intensity(factor = 0.6, label = "easy", assumed = false)
    rpe <= 7.0 -> Intensity(factor = 1.0, label = "moderate", assumed = false)
    else -> Intensity(factor = 1.35, label = "hard", assumed = false)
}

/**
 * Port of `computeSessionFuellingTarget`. Pre-session carbs only when the
 * session is long or hard enough (not under 45 min and easy); post-session
 * protein anchored to bodyweight and clamped to 20–40 g; post-session carbs
 * scaled by intensity × duration (clamped to 0.5–2 h). With no bodyweight, the
 * absolute defaults. The explanation formats numbers as JS does (`70kg`,
 * `72.5kg`, `30.5-min`).
 */
public fun computeSessionFuellingTarget(input: SessionFuellingTargetInput): SessionFuellingTarget {
    val reasonCodes = mutableListOf<String>()
    val intensity = intensityFactor(input.rpe)
    if (intensity.assumed) reasonCodes += "assumed_moderate_intensity"

    // Comparisons are on statically typed Doubles with Double literals, so they are IEEE 754 like JS:
    // NaN is neither null nor <= 0 and is kept (Double.compareTo would order NaN above everything).
    var durationMin = input.durationMin
    if (durationMin == null || durationMin <= 0.0) {
        durationMin = DEFAULT_DURATION_MIN
        reasonCodes += "assumed_duration_60min"
    }
    val durH = clamp(durationMin / 60.0, 0.5, 2.0)

    val bw = input.bodyweightKg
    if (bw == null || bw <= 0.0) {
        reasonCodes += "no_bodyweight_defaults"
        return SessionFuellingTarget(
            preCarbG = DEFAULT_PRE_CARB_G,
            postCarbG = DEFAULT_POST_CARB_G,
            postProteinG = DEFAULT_POST_PROTEIN_G,
            reasonCodes = reasonCodes,
            explanation = "No bodyweight set — showing general defaults. Add your bodyweight in Settings " +
                "for targets tailored to you. Guidance only.",
        )
    }

    // Post-session protein: anchored to bodyweight, clamped to a per-meal range.
    val rawProtein = jsRound(bw * POST_PROTEIN_G_PER_KG)
    val postProteinG = clamp(rawProtein, POST_PROTEIN_MIN_G, POST_PROTEIN_MAX_G)
    if (postProteinG != rawProtein) reasonCodes += "post_protein_clamped"

    // Post-session carbs: scale with session load (intensity × duration).
    val postCarbG = jsRound(bw * POST_CARB_BASE_G_PER_KG * intensity.factor * durH)

    // Pre-session carbs: skip for short, easy sessions; otherwise duration re-clamped to 0.75–1.5 h.
    val preCarbG: Double
    if (durationMin < 45.0 && intensity.factor < 1.0) {
        preCarbG = 0.0
        reasonCodes += "short_easy_no_pre"
    } else {
        preCarbG = jsRound(bw * PRE_CARB_BASE_G_PER_KG * intensity.factor * clamp(durH, 0.75, 1.5))
    }

    val preText = if (preCarbG > 0.0) {
        "~${jsNumberToString(preCarbG)}g carbs beforehand, then "
    } else {
        "no pre-fuelling needed; "
    }
    return SessionFuellingTarget(
        preCarbG = preCarbG,
        postCarbG = postCarbG,
        postProteinG = postProteinG,
        reasonCodes = reasonCodes,
        explanation = "For a ${jsNumberToString(durationMin)}-min ${intensity.label} session at " +
            "${jsNumberToString(bw)}kg: $preText" +
            "~${jsNumberToString(postCarbG)}g carbs and ~${jsNumberToString(postProteinG)}g protein to recover. " +
            "Guidance only.",
    )
}
