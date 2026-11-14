package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.CombinedWorkout

/** Where a combined field's text comes from (FieldSource). */
enum class FieldPick(val label: String) {
    First("This workout"),
    Second("The other"),
    Both("Combine both"),
    Custom("Custom"),
}

/** One field's choice; [custom] is the text typed for [FieldPick.Custom]. */
data class FieldChoice(val pick: FieldPick = FieldPick.Both, val custom: String = "") {
    /** The field's text from the two workouts' (getFieldValue): both joined by [separator], blanks left out. */
    fun text(first: String?, second: String?, separator: String): String = when (pick) {
        FieldPick.First -> first.orEmpty()
        FieldPick.Second -> second.orEmpty()
        FieldPick.Both -> listOfNotNull(first, second).filter { it.isNotEmpty() }.joinToString(separator)
        FieldPick.Custom -> custom
    }
}

/** What two workouts become, field by field (CombineWorkoutsDialog); each starts as both combined. */
data class CombineDraft(
    val title: FieldChoice = FieldChoice(),
    val description: FieldChoice = FieldChoice(),
    val notes: FieldChoice = FieldChoice(),
)

const val TITLE_SEPARATOR = " + "
const val DESCRIPTION_SEPARATOR = "\n---\n"
const val NOTES_SEPARATOR = "\n\n"

/** The combined workout: [first]'s day, the chosen text, and the two durations and calories added up. */
fun combinedWorkout(first: WorkoutLogDetail, second: TimelineEntry, draft: CombineDraft): CombinedWorkout = CombinedWorkout(
    date = first.date,
    focus = draft.title.text(first.focus, second.focus, TITLE_SEPARATOR),
    mainWorkout = draft.description.text(first.mainWorkout, second.mainWorkout, DESCRIPTION_SEPARATOR),
    duration = sumOrNull(first.duration, second.duration),
    calories = sumOrNull(first.calories, second.calories),
    notes = draft.notes.text(first.notes, second.notes, NOTES_SEPARATOR).ifEmpty { null },
)

/** The added-up duration and calories (CombinedResultSummary); null when neither has any. */
fun combinedTotals(first: WorkoutLogDetail, second: TimelineEntry): String? = listOfNotNull(
    sumOrNull(first.duration, second.duration)?.let { "$it min total" },
    sumOrNull(first.calories, second.calories)?.let { "$it kcal total" },
).joinToString(" · ").ifEmpty { null }

private fun sumOrNull(a: Int?, b: Int?): Int? = ((a ?: 0) + (b ?: 0)).takeIf { it > 0 }

/**
 * The other logged workouts on [workout]'s day, the ones it can be combined
 * with: only logged workouts can be, as the server deletes the sources by id.
 */
fun combineCandidates(entries: List<TimelineEntry>, workout: WorkoutLogDetail): List<TimelineEntry> = entries
    .filter { it.date == workout.date && it.workoutLogId != null && it.workoutLogId != workout.id }
    .distinctBy { it.workoutLogId }
