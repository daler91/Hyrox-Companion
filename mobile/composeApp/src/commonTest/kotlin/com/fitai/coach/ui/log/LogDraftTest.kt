package com.fitai.coach.ui.log

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.ParsedExercise
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LogDraftTest {
    private val today = "2026-11-08"
    private val squat = ParsedExercise(exerciseName = "back_squat", category = "strength", reps = 5, weight = 80.0, sets = emptyList())

    @Test
    fun aDraftNeedsContentADateAnEffortAndAWholeDuration() {
        val ok = LogDraft(date = today, text = "5 km run", rpe = 6)
        assertNull(ok.saveProblem(today))
        assertEquals("Please add an exercise or describe your workout.", ok.copy(text = "").saveProblem(today))
        assertEquals("Workout date cannot be in the future.", ok.copy(date = "2026-11-10").saveProblem(today))
        assertNull(ok.copy(date = "2026-11-09").saveProblem(today))
        assertEquals("Pick the date of the workout.", ok.copy(date = "08/11/2026").saveProblem(today))
        assertEquals("Rate your effort above, or tap \"Skip RPE\", to save.", ok.copy(rpe = null).saveProblem(today))
        assertNull(ok.copy(rpe = null, skipRpe = true).saveProblem(today))
        assertEquals("Total time must be a whole number of minutes.", ok.copy(duration = "45.5").saveProblem(today))
    }

    @Test
    fun valuesOnTheExerciseBecomeItsFirstSetRow() {
        val withRows = squat.withSetRows()

        assertEquals(1, withRows.sets.size)
        assertEquals(5L, withRows.sets[0].reps)
        assertEquals(80.0, withRows.sets[0].weight)
    }

    @Test
    fun theRequestUsesTheTitleTextAndRows() {
        val draft = LogDraft(date = today, exercises = listOf(squat.withSetRows()), rpe = 7, duration = " 45 ", notes = "felt good")

        val request = draft.toRequest()

        assertEquals("Workout", request.focus)
        assertEquals("Back Squat", request.mainWorkout)
        assertEquals(Patch.of(7), request.rpe)
        assertEquals(Patch.of(45), request.duration)
        assertEquals(Patch.of("felt good"), request.notes)
        assertEquals("back_squat", request.exercises!!.single().exerciseName)
        assertNull(request.structureBlocks)
        // Encodes without the unset fields.
        val json = ApiJson.encodeToString(CreateWorkoutRequest.serializer(), request)
        assertEquals(false, json.contains("planDayId"))
    }
}
