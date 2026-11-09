package com.fitai.coach.ui.planday

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.ParsedExercise
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdRequest
import com.fitai.coach.core.api.generated.PlanDayReparseResponse
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.workout.exerciseGroups
import com.fitai.coach.ui.workout.reorderedSetIds
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlanDayModelTest {
    private val entry = TimelineEntry(
        id = "plan-d1",
        date = "2026-11-10",
        type = TimelineEntry.Type.Planned,
        status = TimelineEntry.Status.Planned,
        focus = "Tempo",
        mainWorkout = "6 x 800 m",
        accessory = "Core",
        planDayId = "d1",
        priority = TimelineEntry.Priority.Supporting,
    )

    private fun set(id: String, exercise: String) =
        ExerciseSetRow(id = id, exerciseName = exercise, category = "strength", setNumber = 1, version = 1)

    @Test
    fun onlyWhatChangedIsSent() {
        val unchanged = PlanDayText.of(entry)
        assertNull(unchanged.changesFrom(entry))
        assertNull(unchanged.copy(title = " Tempo ").changesFrom(entry), "surrounding spaces aren't a change")

        assertEquals(
            PatchPlansDaysByDayIdRequest(focus = "Hill reps", accessory = Patch.clear(), notes = Patch.of("Easy jog back")),
            unchanged.copy(title = "Hill reps", accessory = "", notes = "Easy jog back").changesFrom(entry),
        )
        assertFalse(unchanged.copy(title = "  ").isValid)
    }

    @Test
    fun priorityChangesOnlyOnASessionStillToDo() {
        assertEquals(PriorityTier.Supporting, PriorityTier.of(entry.priority))
        assertTrue(PriorityTier.editable(entry))
        assertFalse(PriorityTier.editable(entry.copy(status = TimelineEntry.Status.Completed)))
        assertFalse(PriorityTier.editable(entry.copy(raceDerived = true)), "a race sets its own tiers")
        assertFalse(PriorityTier.editable(entry.copy(priority = null)))
    }

    private fun reparsed(saved: Boolean, setCount: Long) =
        PlanDayReparseResponse(emptyList<ParsedExercise>(), saved, setCount, rejectedCount = 0, rejectionReasons = emptyList())

    @Test
    fun readingSaysHowManySetsItFound() {
        assertEquals("Found 6 sets", parseResult(reparsed(saved = true, setCount = 6)))
        assertEquals("Found 1 set", parseResult(reparsed(saved = true, setCount = 1)))
        assertEquals("No sets found in that", parseResult(reparsed(saved = false, setCount = 0)))
    }

    @Test
    fun movingAnExerciseMovesAllItsSets() {
        val groups = exerciseGroups(listOf(set("a1", "back_squat"), set("b1", "lunges"), set("a2", "back_squat"), set("c1", "rowing")))
        assertEquals(listOf("back_squat", "lunges", "rowing"), groups.map { it.exerciseName })

        assertEquals(listOf("b1", "a1", "a2", "c1"), reorderedSetIds(groups, index = 1, offset = -1))
        assertEquals(listOf("a1", "a2", "c1", "b1"), reorderedSetIds(groups, index = 1, offset = 1))
        assertNull(reorderedSetIds(groups, index = 0, offset = -1))
        assertNull(reorderedSetIds(groups, index = 2, offset = 1))
    }
}
