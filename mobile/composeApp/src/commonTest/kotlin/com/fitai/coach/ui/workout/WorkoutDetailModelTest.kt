package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryResponseItem
import com.fitai.coach.core.api.generated.SessionGradeIntent
import com.fitai.coach.core.api.generated.SessionGradeVerdict
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.core.exercises.NextTargetStep
import com.fitai.coach.ui.coach.seedMessage
import com.fitai.coach.ui.components.BadgeTone
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkoutDetailModelTest {
    private fun historySet(
        workout: String,
        date: String,
        setNumber: Int,
        reps: Int?,
        weight: Double?,
        plannedReps: Int? = null,
        plannedWeight: Double? = null,
    ) = GetExercisesByExerciseNameHistoryResponseItem(
        id = "$workout-$setNumber",
        workoutLogId = workout,
        exerciseName = "back_squat",
        category = "strength",
        setNumber = setNumber,
        reps = reps,
        weight = weight,
        weightUnit = "kg",
        plannedReps = plannedReps,
        plannedWeight = plannedWeight,
        date = date,
        version = 1,
    )

    private fun set(id: String, exercise: String, setNumber: Int, customLabel: String? = null) =
        ExerciseSetRow(
            id = id,
            exerciseName = exercise,
            customLabel = customLabel,
            category = "strength",
            setNumber = setNumber,
            version = 1,
        )

    @Test
    fun theSeedQuestionNamesTheWorkoutDayAndWhatItHeld() {
        assertEquals(
            "Can you walk me through your take on my Tempo run workout on Monday, Nov 9?",
            seedMessage("Tempo run", "2026-11-09"),
        )
        assertEquals(
            "Can you walk me through your take on my Legs workout on Monday, Nov 9 (2 exercises, 3 sets)?",
            seedMessage(" Legs ", "2026-11-09", listOf(set("a", "back_squat", 1), set("b", "back_squat", 2), set("c", "lunges", 1))),
        )
        assertEquals(
            "Can you walk me through your take on my Carries workout on Monday, Nov 9 (1 exercise, 1 set)?",
            seedMessage("Carries", "2026-11-09", listOf(set("a", "custom", 1, "Sandbag carry"))),
        )
    }

    @Test
    fun lastTimeLeavesOutThisWorkoutAndProgressesFromTheSessionBefore() {
        val history = listOf(
            // The workout being viewed: never "last time".
            historySet("w3", "2026-11-09", 1, 12, 20.0),
            historySet("w2", "2026-11-02", 2, 10, 20.0),
            historySet("w2", "2026-11-02", 1, 10, 20.0),
            historySet("w2", "2026-11-02", 3, 10, 20.0),
            historySet("w1", "2026-10-26", 1, 8, 20.0),
        )

        val summary =
            exerciseHistory(history, currentWorkoutId = "w3", category = "strength", exerciseName = "back_squat", defaultWeightUnit = "lbs")

        assertEquals("Nov 2: 3 × 10 reps · 20 kg", summary.lastTime)
        assertEquals(NextTarget(setCount = 3, reps = 10, weight = 21.25, step = NextTargetStep.Weight(1.25)), summary.next)
        assertEquals("kg", summary.weightUnit)
    }

    @Test
    fun aPrescriptionMissedTwiceInARowIsDeloaded() {
        val history = listOf(
            historySet("w2", "2026-11-02", 1, 5, 100.0, 5, 100.0),
            historySet("w2", "2026-11-02", 2, 4, 100.0, 5, 100.0),
            historySet("w1", "2026-10-26", 1, 5, 100.0, 5, 100.0),
            historySet("w1", "2026-10-26", 2, 3, 100.0, 5, 100.0),
        )

        val next = exerciseHistory(history, "w9", "strength", "back_squat", "kg").next!!

        assertEquals(5, next.reps)
        assertIs<NextTargetStep.Deload>(next.step)
        assertTrue(next.weight < 100.0)
    }

    @Test
    fun aFirstTimeOrNonStrengthExerciseHasNoTarget() {
        val first = exerciseHistory(emptyList(), "w1", "strength", "back_squat", "kg")
        assertNull(first.lastTime)
        assertNull(first.next)
        assertEquals("kg", first.weightUnit)

        val running = exerciseHistory(listOf(historySet("w1", "2026-11-02", 1, 10, 20.0)), "w2", "running", "easy_run", "kg")
        assertEquals("Nov 2: 10 reps · 20 kg", running.lastTime)
        assertNull(running.next)
    }

    @Test
    fun unevenSetsAreListedInTurn() {
        assertEquals(
            "Nov 2: 10 reps · 60 kg / 8 reps · 60 kg",
            lastTimeSummary(listOf(historySet("w", "2026-11-02", 1, 10, 60.0), historySet("w", "2026-11-02", 2, 8, 60.0))),
        )
    }

    @Test
    fun theNextTargetSaysWhatMoved() {
        assertEquals("3 × 11 reps · 60 kg (+1 rep)", nextTargetLabel(NextTarget(3, 11, 60.0, NextTargetStep.Reps), "kg"))
        assertEquals("5 × 5 reps · 102.5 kg (+2.5 kg)", nextTargetLabel(NextTarget(5, 5, 102.5, NextTargetStep.Weight(2.5)), "kg"))
        assertEquals(
            "3 × 5 reps · 135 lbs (repeat: missed last time)",
            nextTargetLabel(NextTarget(3, 5, 135.0, NextTargetStep.Repeat), "lbs"),
        )
        assertEquals("3 × 5 reps · 90 kg (deload −10 kg)", nextTargetLabel(NextTarget(3, 5, 90.0, NextTargetStep.Deload(10.0)), "kg"))
    }

    @Test
    fun gradeLabelsAndTonesFollowTheWeb() {
        assertEquals("Stayed easy", gradeLabel(SessionGradeIntent.Easy, SessionGradeVerdict.OnTarget))
        assertEquals("Held threshold", gradeLabel(SessionGradeIntent.Threshold, SessionGradeVerdict.OnTarget))
        assertEquals("Can't tell", gradeLabel(SessionGradeIntent.Easy, SessionGradeVerdict.Inconclusive))
        assertEquals("Not graded", gradeLabel(SessionGradeIntent.Easy, SessionGradeVerdict.Unknown))
        assertEquals(BadgeTone.Success, gradeTone(SessionGradeVerdict.OnTarget))
        assertEquals(BadgeTone.Warning, gradeTone(SessionGradeVerdict.CreptUp))
        assertEquals(BadgeTone.Danger, gradeTone(SessionGradeVerdict.TooHard))
        assertEquals(BadgeTone.Neutral, gradeTone(SessionGradeVerdict.Ungradeable))
    }

    @Test
    fun timeOfDayIsAClockTime() {
        assertEquals("07:30", formatTimeOfDay(450))
        assertEquals("19:05", formatTimeOfDay(1145))
        assertEquals(450, parseTimeOfDay("7:30"))
        assertEquals(1145, parseTimeOfDay(" 19:05 "))
        assertNull(parseTimeOfDay("24:00"))
        assertNull(parseTimeOfDay("7:60"))
        assertNull(parseTimeOfDay("half seven"))
    }

    @Test
    fun theDetailsNeedATitleAndReadableNumbers() {
        val edit = DetailsEdit(title = "Legs", duration = "45", timeOfDay = "07:30", rpe = 7, notes = "", countsAsTraining = true)
        assertTrue(edit.isValid())
        assertTrue(edit.copy(duration = "", timeOfDay = "").isValid())
        assertFalse(edit.copy(title = " ").isValid())
        assertFalse(edit.copy(duration = "45.5").isValid())
        assertFalse(edit.copy(timeOfDay = "25:00").isValid())
    }

    @Test
    fun searchingTheLibraryPutsPrefixMatchesFirstAndNeverListsCustom() {
        val names = searchExercises("wall")
        assertTrue(names.isNotEmpty())
        assertTrue(names.first().startsWith("wall"), names.toString())
        assertTrue("custom" !in searchExercises(""))
        assertTrue("custom" !in searchExercises("custom"))
        assertEquals(searchExercises("").size, searchExercises("  ").size)
    }

    @Test
    fun paceSpeedAndCadenceReadAsOnTheWeb() {
        assertEquals("5:00/km", formatPace(1000.0 / 300, "km"))
        assertEquals("8:03/mi", formatPace(1000.0 / 300, "miles"))
        assertEquals("-", formatPace(0.0, "km"))
        assertEquals("30 km/h", formatSpeed(30 / 3.6, "km"))
        assertEquals("rpm", cadenceUnitFor("VirtualRide"))
        assertEquals("spm", cadenceUnitFor("Run"))
        assertEquals("spm", cadenceUnitFor(null))
    }

    @Test
    fun aStopOfAMinuteOrMoreMakesTheDurationMovingTime() {
        val stopped = buildJsonObject {
            put(
                "raw",
                buildJsonObject {
                    put("moving_time", 3000)
                    put("elapsed_time", 3090)
                },
            )
        }
        assertEquals(90, stoppedSeconds(stopped))
        assertTrue(reportsMovingTime(stopped))
        val brief = buildJsonObject {
            put(
                "raw",
                buildJsonObject {
                    put("moving_time", 3000)
                    put("elapsed_time", 3030)
                },
            )
        }
        assertFalse(reportsMovingTime(brief))
        assertNull(stoppedSeconds(JsonNull))
    }

    private fun day(id: String, date: String, status: TimelineEntry.Status = TimelineEntry.Status.Planned, logged: Boolean = false) =
        TimelineEntry(
            id = id,
            date = date,
            type = TimelineEntry.Type.Planned,
            status = status,
            focus = "Session $id",
            mainWorkout = "",
            planDayId = "d-$id",
            workoutLogId = if (logged) "w-$id" else null,
        )

    @Test
    fun aWorkoutCanCountTowardsNearbyPlanDaysWithoutAWorkoutYet() {
        val entries = listOf(
            day("far", "2026-11-25"),
            day("next", "2026-11-11"),
            day("done", "2026-11-10", TimelineEntry.Status.Completed, logged = true),
            day("missed", "2026-11-08", TimelineEntry.Status.Missed),
            day("skipped", "2026-11-09", TimelineEntry.Status.Skipped),
        )

        val options = planDayOptions(entries, "2026-11-09")

        assertEquals(listOf("d-missed", "d-next"), options.map { it.planDayId })
        assertEquals("Sun Nov 8 · Session missed", options.first().label)
        // The day it already counts towards is offered even when done.
        assertTrue(planDayOptions(entries, "2026-11-09", linked = "d-done").any { it.planDayId == "d-done" })
    }
}
