package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryResponseItem
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.SessionGradeIntent
import com.fitai.coach.core.api.generated.SessionGradeVerdict
import com.fitai.coach.core.api.generated.SessionMafCompliance
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.core.exercises.NextTargetStep
import com.fitai.coach.core.exercises.ProgressionSet
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.core.exercises.isRunningExerciseName
import com.fitai.coach.core.exercises.suggestNextTarget
import com.fitai.coach.core.units.KM_TO_MILES
import com.fitai.coach.core.units.convertWeight
import com.fitai.coach.core.units.metersToUserDistance
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.formatSetDistance
import com.fitai.coach.ui.format.formatWeight
import com.fitai.coach.ui.format.shortDate
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
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
    /** Last time's sets in order, for "Use last". */
    val lastSets: List<HistorySet> = emptyList(),
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
    return ExerciseHistory(
        lastTime = last.takeIf { it.isNotEmpty() }?.let(::lastTimeSummary),
        next = next,
        weightUnit = weightUnit,
        lastSets = last,
    )
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

/**
 * "Use last" (buildUseLastPatches): each set takes the values of the same set
 * last time, pairwise, as far as both go. A weight logged in the other unit is
 * converted to this set's; a distance in another unit is left alone.
 */
fun useLastPatches(current: List<ExerciseSetRow>, last: List<HistorySet>): List<Pair<String, PatchWorkoutsByIdSetsBySetIdRequest>> =
    current.zip(last).mapNotNull { (set, before) ->
        val weight = before.weight?.let { value ->
            if (set.weightUnit == null || before.weightUnit == null) value else convertWeight(value, before.weightUnit, set.weightUnit)
        }
        val distance = before.distance?.takeIf {
            set.distanceUnit == null || before.distanceUnit == null ||
                set.distanceUnit == before.distanceUnit
        }
        val patch = PatchWorkoutsByIdSetsBySetIdRequest(
            reps = before.reps?.let { Patch.of(it) } ?: Patch.Absent,
            weight = weight?.let { Patch.of(it) } ?: Patch.Absent,
            distance = distance?.let { Patch.of(it) } ?: Patch.Absent,
            time = before.time?.let { Patch.of(it) } ?: Patch.Absent,
        )
        (set.id to patch).takeIf { patch != PatchWorkoutsByIdSetsBySetIdRequest() }
    }

/** What a set becomes when its exercise is changed: a library exercise, or a custom one by its label. */
data class ExerciseIdentity(val exerciseName: String, val category: String, val customLabel: String?) {
    companion object {
        fun of(exerciseName: String, customLabel: String?): ExerciseIdentity {
            val definition = EXERCISE_DEFINITIONS[exerciseName]
            return ExerciseIdentity(
                exerciseName = if (definition != null) exerciseName else CUSTOM_EXERCISE,
                category = definition?.category ?: CUSTOM_EXERCISE_CATEGORY,
                customLabel = customLabel,
            )
        }
    }
}

/** Swaps a logged set's exercise (Change exercise), keeping its values. */
fun changeExercisePatch(exerciseName: String, customLabel: String?): PatchWorkoutsByIdSetsBySetIdRequest {
    val identity = ExerciseIdentity.of(exerciseName, customLabel)
    return PatchWorkoutsByIdSetsBySetIdRequest(
        exerciseName = identity.exerciseName,
        category = identity.category,
        customLabel = identity.customLabel?.let { Patch.of(it) } ?: Patch.clear(),
    )
}

/** A custom exercise's category, as adding one gives it. */
const val CUSTOM_EXERCISE_CATEGORY = "conditioning"

/**
 * "planned 5 reps, 60 kg" where the sets differ from their plan
 * (buildPlannedDiffSummary); a planned value that differs between sets reads
 * "reps varied". Null when every set went to plan.
 */
fun plannedDiffSummary(sets: List<ExerciseSetRow>): String? {
    val parts = PlannedField.entries
        .filter { field -> sets.any { set -> field.planned(set)?.let { it != field.actual(set) } == true } }
        .mapNotNull { field -> plannedFieldSummary(sets, field) }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(", ", prefix = "planned ")
}

private enum class PlannedField(val label: String, val planned: (ExerciseSetRow) -> Double?, val actual: (ExerciseSetRow) -> Double?) {
    Reps("reps", { it.plannedReps?.toDouble() }, { it.reps?.toDouble() }),
    Weight("weight", { it.plannedWeight }, { it.weight }),
    Distance("distance", { it.plannedDistance }, { it.distance }),
    Time("time", { it.plannedTime }, { it.time }),
}

private fun plannedFieldSummary(sets: List<ExerciseSetRow>, field: PlannedField): String? {
    val values = sets.mapNotNull(field.planned)
    val first = values.firstOrNull() ?: return null
    val unitOf = sets.first()
    return when {
        values.any { it != first } -> "${field.label} varied"
        field == PlannedField.Weight -> formatWeight(first, unitOf.weightUnit)
        field == PlannedField.Distance -> formatSetDistance(first, unitOf.distanceUnit)
        field == PlannedField.Time -> "${formatNumber(first)} min"
        else -> "${formatNumber(first)} reps"
    }
}

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
fun deviceDetails(workout: WorkoutLogDetail, distanceUnit: String?): List<DeviceDetail> {
    if (workout.stravaActivityId == null && workout.source != "strava") return emptyList()
    val running = workout.exerciseSets.any { isRunningExerciseName(it.exerciseName) }
    return buildList {
        workout.avgSpeed?.takeIf { it > 0 }?.let { speed ->
            add(
                if (running) {
                    DeviceDetail(
                        formatPace(speed, distanceUnit),
                        "pace",
                    )
                } else {
                    DeviceDetail(formatSpeed(speed, distanceUnit), "avg speed")
                },
            )
        }
        workout.avgCadence?.takeIf { it > 0 }?.let { cadence ->
            add(DeviceDetail(listOfNotNull("${cadence.roundToInt()}", workout.avgCadenceUnit?.label).joinToString(" "), "cadence"))
        }
        workout.avgWatts?.takeIf { it > 0 }?.let { add(DeviceDetail("$it W", "power")) }
        workout.sufferScore?.takeIf { it > 0 }?.let { add(DeviceDetail("$it", "relative effort")) }
    }
}

/** One of the recording's figures and what it measures: "6:02/km" "pace". */
data class DeviceDetail(val value: String, val label: String) {
    val text: String get() = "$value $label"
}

/**
 * One tile of the summary card (SummaryStat): what it measures, the figure and
 * its unit. The Avg HR tile also carries how it sat against the MAF ceiling.
 */
data class SummaryStat(val label: String, val value: String, val unit: String? = null, val status: MafStatus? = null) {
    /** "Duration 23 min, 19 over MAF", as a screen reader says the tile. */
    val spoken: String get() = listOfNotNull("$label $value", unit).joinToString(" ") + (status?.let { ", ${it.label}" } ?: "")
}

/**
 * The summary card's tiles for a logged workout, in the web's order
 * (buildCompletedStats): duration, named moving time when the recording stood
 * still a while, then distance, heart rate, calories and effort. Maximum heart
 * rate is the app's own addition, after the average it qualifies.
 */
fun summaryStats(workout: WorkoutLogDetail, distanceUnit: String?): List<SummaryStat> = buildList {
    workout.duration?.takeIf { it > 0 }?.let {
        add(SummaryStat(if (reportsMovingTime(workout.deviceActivity)) "Moving time" else "Duration", "$it", "min"))
    }
    workout.distanceMeters?.takeIf { it > 0 }?.let { meters ->
        val value = roundTo1(metersToUserDistance(meters, distanceUnit))
        add(SummaryStat("Distance", formatNumber(value), if (distanceUnit == MILES) "mi" else "km"))
    }
    workout.avgHeartrate?.takeIf { it > 0 }?.let { add(SummaryStat("Avg HR", "$it", "bpm", mafStatus(workout.mafCompliance))) }
    workout.maxHeartrate?.takeIf { it > 0 }?.let { add(SummaryStat("Max HR", "$it", "bpm")) }
    workout.calories?.takeIf { it > 0 }?.let { add(SummaryStat("Calories", "$it", "kcal")) }
    workout.rpe?.let { add(SummaryStat("RPE", "$it/10")) }
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

/** "4:35/km" from metres per second (formatPace). */
fun formatPace(metersPerSecond: Double, distanceUnit: String?): String {
    if (metersPerSecond <= 0) return "-"
    val perKm = METERS_PER_KM / metersPerSecond
    val miles = distanceUnit == MILES
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
    return if (distanceUnit == MILES) {
        "${formatNumber(roundTo1(kmPerHour * KM_TO_MILES))} mph"
    } else {
        "${formatNumber(roundTo1(kmPerHour))} km/h"
    }
}

/** The server's unit for the cadence: pedal "rpm" on a ride, "spm" otherwise; unknown to this build, none. */
private val WorkoutLogDetail.AvgCadenceUnit.label: String?
    get() = wireValue.takeIf { it.isNotEmpty() }

private fun roundTo1(value: Double) = (value * TENTHS).roundToInt() / TENTHS

/** How the workout's average heart rate sat against the MAF ceiling, as its chip says it (summariseMafTile). */
data class MafStatus(val label: String, val tone: BadgeTone, val cue: String)

/**
 * The server's MAF score as a chip: "4 over MAF", "MAF peaks" (the average
 * held but the peak didn't), "at MAF" or "2 under MAF", with the coach's cue.
 * The words carry it, never the colour alone.
 */
fun mafStatus(compliance: SessionMafCompliance?): MafStatus? {
    val over = compliance?.avgOverBy ?: return null
    return when (compliance.classification) {
        SessionMafCompliance.Classification.OverCeiling -> MafStatus("$over over MAF", BadgeTone.Danger, compliance.nextAction)
        SessionMafCompliance.Classification.MostlyCompliant -> MafStatus("MAF peaks", BadgeTone.Warning, compliance.nextAction)
        SessionMafCompliance.Classification.Compliant ->
            MafStatus(if (over == 0L) "at MAF" else "${-over} under MAF", BadgeTone.Success, compliance.nextAction)
        SessionMafCompliance.Classification.Unknown -> null
    }
}

private const val MIN_REPORTABLE_STOPPED_SECONDS = 60

/** The distance preference of an athlete on miles; anything else is kilometres. */
private const val MILES = "miles"
private const val METERS_PER_KM = 1000.0
private const val SECONDS_PER_MINUTE = 60
private const val SECONDS_PER_HOUR = 3600.0
private const val TENTHS = 10.0

/**
 * Whether the workout has text to read into sets: the server reads its
 * prescription, else what was written as its description.
 */
fun hasReadableText(workout: WorkoutLogDetail): Boolean =
    (workout.prescribedMainWorkout ?: workout.mainWorkout).isNotBlank() ||
        !(workout.prescribedAccessory ?: workout.accessory).isNullOrBlank()
