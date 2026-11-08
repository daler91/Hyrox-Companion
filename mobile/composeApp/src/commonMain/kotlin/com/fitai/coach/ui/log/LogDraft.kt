package com.fitai.coach.ui.log

import com.fitai.coach.core.api.generated.ParsedExercise
import com.fitai.coach.core.api.generated.ParsedStructureBlock
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.isIsoCalendarDate
import com.fitai.coach.ui.format.exerciseLabel
import kotlinx.serialization.Serializable

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
    else -> null
}

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
