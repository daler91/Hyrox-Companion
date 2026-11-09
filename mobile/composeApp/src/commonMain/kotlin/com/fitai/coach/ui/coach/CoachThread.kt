package com.fitai.coach.ui.coach

import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.ChatFocus
import com.fitai.coach.core.dates.weekdayName
import com.fitai.coach.ui.format.shortDate

/**
 * "Ask coach" on one workout: its own thread with the coach, the title shown
 * above it, and the question the message box starts with, as the web's
 * embedded workout chat does (EmbeddedWorkoutCoachChat.tsx).
 */
data class CoachThread(val focus: ChatFocus, val title: String, val seed: String) {
    companion object {
        /** The thread about a timeline entry: its plan day and/or logged workout. */
        fun of(entry: TimelineEntry): CoachThread = CoachThread(
            focus = ChatFocus(planDayId = entry.planDayId, workoutLogId = entry.workoutLogId),
            title = entry.focus.trim().ifEmpty { "This workout" },
            seed = seedMessage(entry.focus, entry.date),
        )

        /** The thread about a logged workout, with what it has in it. */
        fun of(workout: WorkoutLogDetail): CoachThread = CoachThread(
            focus = ChatFocus(planDayId = workout.planDayId, workoutLogId = workout.id),
            title = workout.focus.trim().ifEmpty { "This workout" },
            seed = seedMessage(workout.focus, workout.date, workout.exerciseSets),
        )
    }
}

/**
 * The question a workout's thread starts with (buildWorkoutCoachSeedMessage):
 * "Can you walk me through your take on my Tempo run workout on Monday, Nov 9
 * (2 exercises, 6 sets)?". The athlete can edit it before sending.
 */
fun seedMessage(focus: String, date: String, sets: List<ExerciseSetRow> = emptyList()): String {
    val name = focus.trim().ifEmpty { "this workout" }
    val exercises = sets.map { it.exerciseName to it.customLabel }.distinct().size
    val stats = if (exercises > 0) {
        " ($exercises ${if (exercises == 1) "exercise" else "exercises"}, ${sets.size} ${if (sets.size == 1) "set" else "sets"})"
    } else {
        ""
    }
    return "Can you walk me through your take on my $name workout on ${weekdayName(date)}, ${shortDate(date)}$stats?"
}

/** Keeps the open thread across a configuration change; an empty list is "no thread". */
val CoachThreadSaver: Saver<CoachThread?, Any> = listSaver(
    save = { thread ->
        thread?.let { listOf(it.focus.planDayId.orEmpty(), it.focus.workoutLogId.orEmpty(), it.title, it.seed) }.orEmpty()
    },
    restore = { saved ->
        saved.takeIf { it.size == SAVED_FIELDS }?.let { fields ->
            val (planDayId, workoutLogId, title) = fields
            CoachThread(ChatFocus(planDayId.ifEmpty { null }, workoutLogId.ifEmpty { null }), title, seed = fields.last())
        }
    },
)

private const val SAVED_FIELDS = 4
