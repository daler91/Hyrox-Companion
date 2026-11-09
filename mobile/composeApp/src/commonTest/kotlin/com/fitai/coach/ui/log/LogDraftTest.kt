package com.fitai.coach.ui.log

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.ParsedExercise
import com.fitai.coach.core.api.generated.WorkoutLatest
import kotlinx.serialization.json.JsonNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

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

    @Test
    fun theExtraFieldsMustReadAsNumbersAndAClockTime() {
        val ok = LogDraft(date = today, text = "5 km run", rpe = 6)
        assertNull(ok.copy(timeOfDay = "7:30", distance = "5.2", avgHeartrate = "145", maxHeartrate = "178").saveProblem(today))
        assertEquals("Time of day must be a clock time, like 07:30.", ok.copy(timeOfDay = "half seven").saveProblem(today))
        assertEquals("Distance must be a number.", ok.copy(distance = "far").saveProblem(today))
        assertEquals("Heart rate must be a whole number between 20 and 250 bpm.", ok.copy(maxHeartrate = "300").saveProblem(today))
    }

    @Test
    fun theExtrasGoInTheRequestWithTheDistanceInMetres() {
        val draft = LogDraft(
            date = today,
            text = "Run",
            rpe = 5,
            timeOfDay = "07:30",
            distance = "5",
            avgHeartrate = "145",
            maxHeartrate = "178",
            planDayId = "d1",
        )

        val request = draft.toRequest(distanceUnit = "km")

        assertEquals(Patch.of(450), request.timeOfDayMin)
        assertEquals(Patch.of(5000.0), request.distanceMeters)
        assertEquals(Patch.of(145), request.avgHeartrate)
        assertEquals(Patch.of(178), request.maxHeartrate)
        assertEquals(Patch.of("d1"), request.planDayId)
        assertEquals(Patch.of(8047.0), draft.toRequest(distanceUnit = "miles").distanceMeters)
    }

    private fun latest(sets: List<ExerciseSetRow>, mainWorkout: String = "Squats") = WorkoutLatest(
        id = "w1",
        userId = "u1",
        date = "2026-11-01",
        focus = "Leg day",
        mainWorkout = mainWorkout,
        notes = "felt strong",
        rpe = 8,
        duration = 50,
        countsAsTraining = true,
        autoLinkRecordingOnly = false,
        deviceActivity = JsonNull,
        exerciseSets = sets,
        structureBlocks = emptyList(),
    )

    private fun set(id: String, exercise: String, weight: Double?, unit: String?) =
        ExerciseSetRow(
            id = id,
            exerciseName = exercise,
            category = "strength",
            setNumber = 1,
            reps = 5,
            weight = weight,
            weightUnit = unit,
            version = 1,
        )

    @Test
    fun theLastWorkoutBecomesTodaysDraftInTheAthletesUnits() {
        val draft = draftFrom(
            latest(listOf(set("a", "back_squat", 100.0, "kg"), set("b", "lunges", null, null), set("c", "back_squat", 100.0, "kg"))),
            today,
            weightUnit = "lbs",
        )

        assertEquals(today, draft.date)
        assertEquals("Leg day", draft.title)
        assertEquals("felt strong", draft.notes)
        assertEquals("", draft.text, "the rows stand for the text")
        assertNull(draft.rpe, "effort is this session's")
        assertEquals(listOf("back_squat", "lunges"), draft.exercises.map { it.exerciseName })
        assertEquals(listOf(1L, 2L), draft.exercises.first().sets.map { it.setNumber })
        assertEquals(220.5, draft.exercises.first().sets.first().weight)
    }

    @Test
    fun aWorkoutLoggedAsTextComesBackAsItsText() {
        val draft = draftFrom(latest(emptyList(), mainWorkout = "5 x 1 km at threshold"), today, weightUnit = "kg")

        assertEquals("5 x 1 km at threshold", draft.text)
        assertTrue(draft.exercises.isEmpty())
    }
}
