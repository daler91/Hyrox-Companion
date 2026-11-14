package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.CombinedWorkout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CombineModelTest {
    private val run = ApiJson.decodeFromString(
        WorkoutLogDetail.serializer(),
        """{"id":"w1","userId":"u1","date":"2026-11-08","focus":"Run","mainWorkout":"5 km easy","notes":"Windy",""" +
            """"duration":30,"calories":250,"countsAsTraining":true,"autoLinkRecordingOnly":false,"deviceActivity":{},""" +
            """"exerciseSets":[],"structureBlocks":[]}""",
    )

    private fun logged(id: String, workoutLogId: String?, date: String = "2026-11-08", focus: String = "Lift") = TimelineEntry(
        id = id,
        date = date,
        type = TimelineEntry.Type.Logged,
        status = TimelineEntry.Status.Completed,
        focus = focus,
        mainWorkout = "Squats 5x5",
        workoutLogId = workoutLogId,
        duration = 45,
        calories = 350,
    )

    private val lift = logged("log-w2", "w2")

    @Test
    fun eachFieldTakesOneSideBothOrCustomText() {
        assertEquals("Run", FieldChoice(FieldPick.First).text("Run", "Lift", " + "))
        assertEquals("Lift", FieldChoice(FieldPick.Second).text("Run", "Lift", " + "))
        assertEquals("Run + Lift", FieldChoice().text("Run", "Lift", " + "))
        assertEquals("Lift", FieldChoice().text("", "Lift", " + "))
        assertEquals("Leg day", FieldChoice(FieldPick.Custom, "Leg day").text("Run", "Lift", " + "))
        assertEquals("", FieldChoice(FieldPick.Second).text("Run", null, " + "))
    }

    @Test
    fun theCombinedWorkoutJoinsTheTextAndAddsUpTimeAndCalories() {
        assertEquals(
            CombinedWorkout(
                date = "2026-11-08",
                focus = "Run + Lift",
                mainWorkout = "5 km easy\n---\nSquats 5x5",
                duration = 75,
                calories = 600,
                notes = "Windy",
            ),
            combinedWorkout(run, lift, CombineDraft()),
        )
        assertEquals("75 min total · 600 kcal total", combinedTotals(run, lift))
    }

    @Test
    fun blankNotesAndNoTotalsAreLeftOut() {
        val bare = run.copy(notes = null, duration = null, calories = null)
        val other = lift.copy(duration = null, calories = null)

        val combined = combinedWorkout(bare, other, CombineDraft(notes = FieldChoice(FieldPick.Second)))

        assertNull(combined.notes)
        assertNull(combined.duration)
        assertNull(combinedTotals(bare, other))
    }

    @Test
    fun onlyOtherLoggedWorkoutsTheSameDayCanBeCombined() {
        val entries = listOf(
            logged("log-w1", "w1"),
            lift,
            logged("plan-d3", null),
            logged("log-w4", "w4", date = "2026-11-09"),
            logged("again", "w2"),
        )

        assertEquals(listOf("log-w2"), combineCandidates(entries, run).map { it.id })
    }
}
