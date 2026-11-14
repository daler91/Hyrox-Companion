package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.generated.GetMafTestsResponse
import com.fitai.coach.core.api.generated.MafTestResult
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.MafMetrics
import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.units.metersToUserDistance
import com.fitai.coach.core.units.userDistanceToMeters
import com.fitai.coach.ui.analytics.MAF_TRAINING_STYLE
import com.fitai.coach.ui.analytics.formatSplit
import kotlin.math.roundToInt

/** Heart rates the server accepts (manualMetrics). */
const val MIN_HEART_RATE = 20
const val MAX_HEART_RATE = 250
private const val MAX_DISTANCE_METERS = 1_000_000L
private const val SECONDS_PER_MINUTE = 60
private const val THOUSANDTHS = 1000.0

/**
 * The MAF test row on a workout (MafTestTagSection): whether the run is in
 * the athlete's MAF trend, and the metrics it was saved with, to correct.
 */
data class MafTag(val tagged: Boolean, val saved: MafTestResult.Metrics? = null)

/** MAF-method athletes with a ceiling worked out; the server refuses the tag for anyone else. */
fun isMafAthlete(prefs: PreferencesResponse?): Boolean = prefs?.trainingStyleId == MAF_TRAINING_STYLE && prefs.mafHr != null

/**
 * The workout's MAF row; null when it doesn't show. A test without a heart
 * rate has no compliance row, so both lists count (isWorkoutTagged).
 */
fun mafTag(prefs: PreferencesResponse?, tests: GetMafTestsResponse?, workoutId: String): MafTag? {
    if (!isMafAthlete(prefs)) return null
    val test = tests?.tests?.firstOrNull { it.conditions?.workoutLogId == workoutId }
    val scored = tests?.analysis?.any { it.workoutLogId == workoutId } == true
    return MafTag(tagged = test != null || scored, saved = test?.metrics)
}

/** The MAF test form as typed, distance in the athlete's unit (MafTestForm). */
data class MafForm(val avgHr: String = "", val maxHr: String = "", val duration: String = "", val distance: String = "") {
    /** The first thing wrong with what's typed, in the web's words; null when it can be saved. */
    fun error(distanceUnit: String?): String? = distanceError(distanceUnit)
        ?: heartRateError(avgHr, "Average")
        ?: heartRateError(maxHr, "Max")
        ?: orderError()
        ?: durationError()

    /** What's saved: blanks as null, distance in metres. Check [error] first. */
    fun metrics(distanceUnit: String?): MafMetrics = MafMetrics(
        avgHeartRate = parseOptionalInt(avgHr),
        maxHeartRate = parseOptionalInt(maxHr),
        durationSeconds = parseDurationToSeconds(duration),
        distanceMeters = parseOptionalDistanceMeters(distance, distanceUnit),
    )

    private fun distanceError(distanceUnit: String?): String? = parseOptionalDistanceMeters(distance, distanceUnit)
        ?.takeIf { it > MAX_DISTANCE_METERS }
        ?.let { "That distance looks too large — please double-check it." }

    private fun orderError(): String? {
        val avg = parseOptionalInt(avgHr)
        val max = parseOptionalInt(maxHr)
        return if (avg != null && max != null && max < avg) "Max heart rate can't be lower than average heart rate." else null
    }

    private fun durationError(): String? {
        val seconds = parseDurationToSeconds(duration)
        val unreadable = duration.isNotBlank() && (seconds == null || seconds <= 0)
        return if (unreadable) "Enter duration as mm:ss — for example 28:30." else null
    }

    companion object {
        /** Tagging: the run's own values. A workout's duration is in minutes. */
        fun forWorkout(workout: WorkoutLogDetail, distanceUnit: String?): MafForm = of(
            avgHeartRate = workout.avgHeartrate?.toDouble(),
            maxHeartRate = workout.maxHeartrate?.toDouble(),
            durationSeconds = workout.duration?.let { it * SECONDS_PER_MINUTE.toDouble() },
            distanceMeters = workout.distanceMeters,
            distanceUnit = distanceUnit,
        )

        /** Correcting: the values the test was saved with. */
        fun forTest(saved: MafTestResult.Metrics?, distanceUnit: String?): MafForm = of(
            avgHeartRate = saved?.avgHeartRate,
            maxHeartRate = saved?.maxHeartRate,
            durationSeconds = saved?.durationSeconds,
            distanceMeters = saved?.distanceMeters,
            distanceUnit = distanceUnit,
        )

        private fun of(
            avgHeartRate: Double?,
            maxHeartRate: Double?,
            durationSeconds: Double?,
            distanceMeters: Double?,
            distanceUnit: String?,
        ) = MafForm(
            avgHr = avgHeartRate?.roundToInt()?.toString().orEmpty(),
            maxHr = maxHeartRate?.roundToInt()?.toString().orEmpty(),
            duration = durationSeconds?.let(::formatSplit).orEmpty(),
            // Three decimals at most, trailing zeros dropped.
            distance = distanceMeters?.let { jsNumberToString(jsRound(metersToUserDistance(it, distanceUnit) * THOUSANDTHS) / THOUSANDTHS) }
                .orEmpty(),
        )
    }
}

/** "a whole number" check as the web's: fractions and text aren't one (Number.isInteger). */
private fun wholeNumber(text: String): Long? = text.trim().toDoubleOrNull()
    ?.takeIf { it.isFinite() && it % 1.0 == 0.0 && it in Long.MIN_VALUE.toDouble()..Long.MAX_VALUE.toDouble() }
    ?.toLong()

private fun heartRateError(raw: String, label: String): String? {
    val bpm = wholeNumber(raw)
    return when {
        raw.isBlank() -> null
        bpm == null -> "$label heart rate must be a whole number."
        bpm !in MIN_HEART_RATE..MAX_HEART_RATE -> "$label heart rate must be between $MIN_HEART_RATE and $MAX_HEART_RATE bpm."
        else -> null
    }
}

/** A typed whole number; blank, text or a fraction is "not entered" (parseOptionalInt). */
private fun parseOptionalInt(text: String): Int? = wholeNumber(text)?.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()

/** A typed distance in the athlete's unit as whole metres; blank, text or negative is "not entered". */
private fun parseOptionalDistanceMeters(text: String, distanceUnit: String?): Double? = text.trim().toDoubleOrNull()
    ?.takeIf { it.isFinite() && it >= 0 }
    ?.let { jsRound(userDistanceToMeters(it, distanceUnit)) }

/**
 * Seconds from "28:30", "1:05:00" or a bare number of minutes ("45");
 * null when it doesn't read as a time, as "12:75" doesn't (parseDurationToSeconds).
 */
fun parseDurationToSeconds(text: String): Int? {
    val trimmed = text.trim()
    return when {
        trimmed.isEmpty() -> null
        ':' !in trimmed -> trimmed.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }?.let { jsRound(it * SECONDS_PER_MINUTE).toInt() }
        else -> clockSeconds(trimmed.split(":"))
    }
}

private fun clockSeconds(parts: List<String>): Int? {
    val numbers = parts.map { part -> part.takeIf { it.isNotEmpty() && it.all { c -> c in '0'..'9' } }?.toLongOrNull() }
    val valid = parts.size in 2..3 &&
        numbers.all { it != null } &&
        // The smallest unit can't overflow ("12:75"), nor the minutes of "h:mm:ss".
        numbers.last()!! < SECONDS_PER_MINUTE &&
        (parts.size == 2 || numbers[1]!! < SECONDS_PER_MINUTE)
    return if (valid) numbers.fold(0L) { total, n -> total * SECONDS_PER_MINUTE + n!! }.takeIf { it <= Int.MAX_VALUE }?.toInt() else null
}
