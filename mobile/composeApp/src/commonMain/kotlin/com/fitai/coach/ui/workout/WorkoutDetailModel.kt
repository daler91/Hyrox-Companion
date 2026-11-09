package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryResponseItem
import com.fitai.coach.core.api.generated.SessionGradeIntent
import com.fitai.coach.core.api.generated.SessionGradeVerdict
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.core.exercises.NextTargetStep
import com.fitai.coach.core.exercises.ProgressionSet
import com.fitai.coach.core.exercises.isRunningExerciseName
import com.fitai.coach.core.exercises.suggestNextTarget
import com.fitai.coach.core.units.KM_TO_MILES
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.formatSetDistance
import com.fitai.coach.ui.format.formatWeight
import com.fitai.coach.ui.format.shortDate
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.roundToInt

private typealias HistorySet = GetExercisesByExerciseNameHistoryResponseItem

/** What an exercise looked like last time, and the target for this time (LastTimeRow.tsx). */
data class ExerciseHistory(
    /** "Nov 2: 3 × 10 reps · 60 kg"; null when the exercise hasn't been logged before. */
    val lastTime: String?,
    /** The suggested next prescription; strength exercises only. */
    val next: NextTarget?,
    val weightUnit: String,
)

/**
 * Splits an exercise's history (newest session first) into its sessions,
 * leaving out the workout being viewed, and works out "last time" and the
 * next target from the two most recent.
 */
fun exerciseHistory(
    history: List<HistorySet>,
    currentWorkoutId: String,
    category: String,
    exerciseName: String,
    defaultWeightUnit: String,
): ExerciseHistory {
    val sessions = history
        .filter { it.workoutLogId != currentWorkoutId }
        .groupBy { it.workoutLogId ?: it.date }
        .values
        .toList()
    val last = sessions.getOrNull(0).orEmpty().sortedBy { it.setNumber }
    val previous = sessions.getOrNull(1)?.sortedBy { it.setNumber }
    val weightUnit = last.firstNotNullOfOrNull { it.weightUnit } ?: defaultWeightUnit
    val next = last.takeIf { it.isNotEmpty() }?.let {
        suggestNextTarget(
            lastSets = it.map(::progressionSet),
            category = category,
            weightUnit = weightUnit,
            previousSets = previous?.map(::progressionSet),
            exerciseName = exerciseName,
        )
    }
    return ExerciseHistory(lastTime = last.takeIf { it.isNotEmpty() }?.let(::lastTimeSummary), next = next, weightUnit = weightUnit)
}

private fun progressionSet(set: HistorySet) =
    ProgressionSet(reps = set.reps, weight = set.weight, plannedReps = set.plannedReps, plannedWeight = set.plannedWeight)

/**
 * "Nov 2: 3 × 10 reps · 60 kg" when every set was the same, else each set in
 * turn: "Nov 2: 10 reps · 60 kg / 8 reps · 60 kg".
 */
fun lastTimeSummary(sets: List<HistorySet>): String {
    val parts = sets.map(::historySetSummary)
    val body = if (parts.distinct().size == 1 && sets.size > 1) "${sets.size} × ${parts.first()}" else parts.joinToString(" / ")
    return "${shortDate(sets.first().date)}: $body"
}

private fun historySetSummary(set: HistorySet): String = buildList {
    set.reps?.let { add("$it reps") }
    set.weight?.let { add(formatWeight(it, set.weightUnit)) }
    set.distance?.let { add(formatSetDistance(it, set.distanceUnit)) }
    set.time?.let { add(formatClock(it)) }
}.ifEmpty { listOf("—") }.joinToString(" · ")

/** "3 × 11 reps · 60 kg (+1 rep)": the target, and the one thing that moved. */
fun nextTargetLabel(target: NextTarget, weightUnit: String): String {
    val why = when (val step = target.step) {
        NextTargetStep.Reps -> "+1 rep"
        is NextTargetStep.Weight -> "+${formatWeight(step.amount, weightUnit)}"
        NextTargetStep.Repeat -> "repeat: missed last time"
        is NextTargetStep.Deload -> "deload −${formatWeight(step.amount, weightUnit)}"
    }
    return "${target.setCount} × ${target.reps} reps · ${formatWeight(target.weight, weightUnit)} ($why)"
}

/** The verdict's short label (sessionGradeFormat.ts getGradeLabel). */
fun gradeLabel(intent: SessionGradeIntent, verdict: SessionGradeVerdict): String = when (verdict) {
    SessionGradeVerdict.OnTarget -> if (intent == SessionGradeIntent.Easy) "Stayed easy" else "Held threshold"
    SessionGradeVerdict.CreptUp -> "Crept up"
    SessionGradeVerdict.TooHard -> "Too hard"
    SessionGradeVerdict.DriftedHarder -> "Drifted harder"
    SessionGradeVerdict.Under -> "Under threshold"
    SessionGradeVerdict.Inconclusive -> "Can't tell"
    SessionGradeVerdict.Ungradeable, SessionGradeVerdict.Unknown -> "Not graded"
}

/** The verdict's colour (getGradeTone): good, partial, low or neutral. */
fun gradeTone(verdict: SessionGradeVerdict): BadgeTone = when (verdict) {
    SessionGradeVerdict.OnTarget -> BadgeTone.Success
    SessionGradeVerdict.CreptUp, SessionGradeVerdict.Under -> BadgeTone.Warning
    SessionGradeVerdict.TooHard, SessionGradeVerdict.DriftedHarder -> BadgeTone.Danger
    SessionGradeVerdict.Inconclusive, SessionGradeVerdict.Ungradeable, SessionGradeVerdict.Unknown -> BadgeTone.Neutral
}

/** "60" for 60.0 and "62.5" for 62.5, for a value typed into a field. */
fun editableNumber(value: Double?): String = value?.let(::formatNumber).orEmpty()

/** "07:30" for 450 minutes after midnight. */
fun formatTimeOfDay(minutes: Int): String {
    val hours = minutes / MINUTES_PER_HOUR
    val rest = minutes % MINUTES_PER_HOUR
    return "${hours.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}"
}

/** Minutes after midnight for "7:30" or "19:05"; null for anything that isn't a clock time. */
fun parseTimeOfDay(text: String): Int? {
    val match = CLOCK_TIME.matchEntire(text.trim()) ?: return null
    val (hours, minutes) = match.destructured.let { (h, m) -> h.toInt() to m.toInt() }
    return if (hours < HOURS_PER_DAY && minutes < MINUTES_PER_HOUR) hours * MINUTES_PER_HOUR + minutes else null
}

private val CLOCK_TIME = Regex("""(\d{1,2}):(\d{2})""")
private const val MINUTES_PER_HOUR = 60
private const val HOURS_PER_DAY = 24

/**
 * A recorded workout's secondary numbers, on one quiet line
 * (WorkoutSummaryHeader's buildDeviceDetails): pace for a run or speed
 * otherwise, cadence, power and relative effort. Only for a workout with a
 * recording linked.
 */
fun deviceDetails(workout: WorkoutLogDetail, distanceUnit: String?): List<String> {
    if (workout.stravaActivityId == null && workout.source != "strava") return emptyList()
    val running = workout.exerciseSets.any { isRunningExerciseName(it.exerciseName) }
    return buildList {
        workout.avgSpeed?.takeIf {
            it > 0
        }?.let { add(if (running) "${formatPace(it, distanceUnit)} pace" else "${formatSpeed(it, distanceUnit)} avg speed") }
        workout.avgCadence?.takeIf {
            it > 0
        }?.let { add("${it.roundToInt()} ${cadenceUnitFor(sportType(workout.deviceActivity))} cadence") }
        workout.avgWatts?.takeIf { it > 0 }?.let { add("$it W power") }
        workout.sufferScore?.takeIf { it > 0 }?.let { add("$it relative effort") }
    }
}

/**
 * Seconds the recording ran while the athlete stood still (stoppedSecondsFor):
 * its elapsed time less its moving time; null with no recording to read.
 */
fun stoppedSeconds(deviceActivity: JsonElement): Int? {
    val raw = recording(deviceActivity)
    val moving = raw?.get("moving_time")?.jsonPrimitive?.doubleOrNull
    val elapsed = raw?.get("elapsed_time")?.jsonPrimitive?.doubleOrNull
    return if (moving == null || elapsed == null) null else (elapsed - moving).roundToInt().coerceAtLeast(0)
}

/** The recording's own summary in the device snapshot, as the provider sent it. */
private fun recording(deviceActivity: JsonElement): JsonObject? = (deviceActivity as? JsonObject)?.get("raw") as? JsonObject

/** Whether a session's duration should read as moving time: it stood still a minute or more (MIN_REPORTABLE_STOPPED_SEC). */
fun reportsMovingTime(deviceActivity: JsonElement): Boolean = (stoppedSeconds(deviceActivity) ?: 0) >= MIN_REPORTABLE_STOPPED_SECONDS

private fun sportType(deviceActivity: JsonElement): String? =
    recording(deviceActivity)?.let { raw -> (raw["sport_type"] ?: raw["type"])?.jsonPrimitive?.contentOrNull }

/** "4:35/km" from metres per second (formatPace). */
fun formatPace(metersPerSecond: Double, distanceUnit: String?): String {
    if (metersPerSecond <= 0) return "-"
    val perKm = METERS_PER_KM / metersPerSecond
    val miles = distanceUnit == "miles"
    val perUnit = if (miles) perKm / KM_TO_MILES else perKm
    var minutes = (perUnit / SECONDS_PER_MINUTE).toInt()
    var seconds = (perUnit % SECONDS_PER_MINUTE).roundToInt()
    if (seconds == SECONDS_PER_MINUTE) {
        minutes += 1
        seconds = 0
    }
    return "$minutes:${seconds.toString().padStart(2, '0')}${if (miles) "/mi" else "/km"}"
}

/** "28.4 km/h" from metres per second (formatSpeed). */
fun formatSpeed(metersPerSecond: Double, distanceUnit: String?): String {
    val kmPerHour = metersPerSecond * SECONDS_PER_HOUR / METERS_PER_KM
    return if (distanceUnit ==
        "miles"
    ) {
        "${formatNumber(roundTo1(kmPerHour * KM_TO_MILES))} mph"
    } else {
        "${formatNumber(roundTo1(kmPerHour))} km/h"
    }
}

/** Pedal "rpm" for a ride, "spm" for everything else (cadenceUnitFor). */
fun cadenceUnitFor(sportType: String?): String =
    if (sportType != null && sportType.lowercase().filter { it.isLetterOrDigit() } in CYCLING_SPORTS) "rpm" else "spm"

private fun roundTo1(value: Double) = (value * TENTHS).roundToInt() / TENTHS

private val CYCLING_SPORTS = setOf(
    "ride", "virtualride", "mountainbikeride", "gravelride", "ebikeride", "emountainbikeride", "handcycle", "velomobile",
    "cycling", "roadbiking", "mountainbiking", "gravelcycling", "indoorcycling", "virtualcycling", "cyclocross",
    "trackcycling", "bmx", "ebikefitness", "ebikemountain", "handcycling", "recumbentcycling",
)
private const val MIN_REPORTABLE_STOPPED_SECONDS = 60
private const val METERS_PER_KM = 1000.0
private const val SECONDS_PER_MINUTE = 60
private const val SECONDS_PER_HOUR = 3600.0
private const val TENTHS = 10.0
