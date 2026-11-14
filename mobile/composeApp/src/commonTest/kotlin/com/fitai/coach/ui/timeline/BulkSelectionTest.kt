package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.TimelineEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BulkSelectionTest {
    private fun entry(id: String, planDayId: String? = null, workoutLogId: String? = null) = TimelineEntry(
        id = id,
        date = "2026-11-08",
        type = if (workoutLogId != null) TimelineEntry.Type.Logged else TimelineEntry.Type.Planned,
        status = if (workoutLogId != null) TimelineEntry.Status.Completed else TimelineEntry.Status.Planned,
        focus = "Run",
        mainWorkout = "",
        planDayId = planDayId,
        workoutLogId = workoutLogId,
    )

    @Test
    fun anEntryIsPickedByItsPlanDayElseItsWorkout() {
        assertEquals("plan:d1", selectionKey(entry("a", planDayId = "d1", workoutLogId = "w1")))
        assertEquals("log:w2", selectionKey(entry("b", workoutLogId = "w2")))
        assertNull(selectionKey(entry("c")))
    }

    @Test
    fun onlyEntriesWithAPlanDayOrWorkoutCanBePicked() {
        val rows = buildTimelineRows(listOf(entry("a", planDayId = "d1"), entry("b", workoutLogId = "w2"), entry("c")), "2026-11-08")

        assertEquals(listOf("a", "b"), selectable(rows).map { it.id })
    }

    @Test
    fun aSelectionKnowsWhatItPicksAndWhenItIsTooBig() {
        val picked = Selection(keys = setOf("plan:d1"))
        assertTrue(picked.picks(entry("a", planDayId = "d1")))
        assertFalse(picked.picks(entry("b", workoutLogId = "w2")))
        assertFalse(picked.tooMany)
        assertTrue(Selection(keys = (1..101).map { "log:w$it" }.toSet()).tooMany)
    }

    @Test
    fun theWordsCountTheWorkouts() {
        assertEquals("Workout removed", removedLabel(1))
        assertEquals("3 workouts removed", removedLabel(3))
        assertTrue(deleteSelectedText(1).startsWith("This will remove 1 selected workout from your timeline."))
        assertTrue(deleteSelectedText(2).startsWith("This will remove 2 selected workouts from your timeline."))
    }
}
