package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryResponseItem
import com.fitai.coach.core.api.generated.SessionGradeIntent
import com.fitai.coach.core.api.generated.SessionGradeVerdict
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.core.exercises.NextTargetStep
import com.fitai.coach.core.exercises.ProgressionSet
import com.fitai.coach.core.exercises.suggestNextTarget
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.formatSetDistance
import com.fitai.coach.ui.format.formatWeight
import com.fitai.coach.ui.format.shortDate

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
