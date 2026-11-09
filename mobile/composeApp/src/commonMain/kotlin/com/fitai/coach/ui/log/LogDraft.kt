package com.fitai.coach.ui.log

import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.ParsedExercise
import com.fitai.coach.core.api.generated.ParsedStructureBlock
import com.fitai.coach.core.api.generated.WorkoutLatest
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.isIsoCalendarDate
import com.fitai.coach.core.units.kgToUserWeight
import com.fitai.coach.core.units.userWeightToKg
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.workout.exerciseGroups
import com.fitai.coach.ui.workout.parseTimeOfDay
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

/** The workout being logged, kept in the user's database so it survives the app being closed. */
@Serializable
data class LogDraft(
    val title: String = "",
    val date: String = "",
    val text: String = "",
    /** The description the rows were parsed from; parsing again is only needed when the text changes. */
    val parsedText: String? = null,
    val exercises: List<ParsedExercise> = emptyList(),
    val blocks: List<ParsedStructureBlock> = emptyList(),
    val rpe: Int? = null,
    val skipRpe: Boolean = false,
    val duration: String = "",
    val notes: String = "",
    /** When it was done, "07:30"; blank for not said. */
    val timeOfDay: String = "",
    /** In the athlete's distance unit (km or miles). */
    val distance: String = "",
    val avgHeartrate: String = "",
    val maxHeartrate: String = "",
    /** The plan day it counts towards, and how that day reads. */
    val planDayId: String? = null,
    val planDayLabel: String? = null,
) {
    val isEmpty: Boolean get() = title.isBlank() && text.isBlank() && exercises.isEmpty() && notes.isBlank()
}

/** Why the draft can't be saved yet, in the web's words; null when it can. */
fun LogDraft.saveProblem(today: String): String? = when {
    text.isBlank() && exercises.isEmpty() -> "Please add an exercise or describe your workout."
    !isIsoCalendarDate(date) -> "Pick the date of the workout."
    date > addDaysToIsoDate(today, 1) -> "Workout date cannot be in the future."
    rpe == null && !skipRpe -> "Rate your effort above, or tap \"Skip RPE\", to save."
    duration.isNotBlank() && duration.trim().toIntOrNull()?.takeIf { it > 0 } == null -> "Total time must be a whole number of minutes."
    else -> measurementProblem()
}

/** Why the optional measurements (time of day, distance, heart rate) don't read; null when they do. */
private fun LogDraft.measurementProblem(): String? = when {
    timeOfDay.isNotBlank() && parseTimeOfDay(timeOfDay) == null -> "Time of day must be a clock time, like 07:30."
    distance.isNotBlank() && distance.trim().toDoubleOrNull()?.takeIf { it >= 0 } == null -> "Distance must be a number."
    listOf(avgHeartrate, maxHeartrate).any { it.isNotBlank() && it.trim().toIntOrNull() !in HEART_RATE_RANGE } ->
        "Heart rate must be a whole number between 20 and 250 bpm."
    else -> null
}

/** The heart rates the web accepts (min 20, max 250). */
private val HEART_RATE_RANGE = 20..250

/**
 * The last workout as a new draft (useDuplicateLastWorkout): dated today,
 * with its title, notes and exercises; effort, time, distance and heart
 * rate are this session's to fill in, and it isn't tied to a plan day. A
 * workout logged as text only comes back as its text. Weights logged in the
 * other unit are converted to [weightUnit], since the draft has no unit of
 * its own.
 */
fun draftFrom(latest: WorkoutLatest, today: String, weightUnit: String?): LogDraft {
    val exercises = latest.exerciseSets.toParsedExercises(weightUnit)
    return LogDraft(
        title = latest.focus,
        date = today,
        text = if (exercises.isEmpty()) latest.mainWorkout else "",
        exercises = exercises,
        notes = latest.notes.orEmpty(),
    )
}

/** Logged sets as draft exercises, one per exercise in the order they first appear. */
fun List<ExerciseSetRow>.toParsedExercises(weightUnit: String?): List<ParsedExercise> = exerciseGroups(this).map { group ->
    ParsedExercise(
        exerciseName = group.exerciseName,
        category = group.sets.first().category,
        customLabel = group.customLabel,
        sets = group.sets.mapIndexed { index, set ->
            ParsedExercise.SetsItem(
                setNumber = index + 1L,
                reps = set.reps?.toLong(),
                weight = set.weight?.let { convertWeight(it, from = set.weightUnit, to = weightUnit) },
                distance = set.distance,
                time = set.time,
            )
        },
    )
}

private fun convertWeight(value: Double, from: String?, to: String?): Double {
    if (from == null || to == null || from == to) return value
    return (kgToUserWeight(userWeightToKg(value, from), to) * TENTHS).roundToInt() / TENTHS
}

private const val TENTHS = 10.0

/** Every exercise has at least one set row: the parser may put the values on the exercise itself. */
fun ParsedExercise.withSetRows(): ParsedExercise = if (sets.isNotEmpty()) {
    this
} else {
    copy(sets = listOf(ParsedExercise.SetsItem(setNumber = 1, reps = reps, weight = weight, distance = distance, time = time)))
}

/** "Back squat 3 sets; Run" — the workout's text when the athlete only built rows. */
fun summarize(exercises: List<ParsedExercise>): String = exercises.joinToString("; ") { exercise ->
    val label = exerciseLabel(exercise.exerciseName, exercise.customLabel)
    if (exercise.sets.size > 1) "$label ${exercise.sets.size} sets" else label
}
