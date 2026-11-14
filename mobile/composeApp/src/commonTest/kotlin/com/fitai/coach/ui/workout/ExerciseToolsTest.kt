package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryResponseItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ExerciseToolsTest {
    private fun set(
        id: String,
        setNumber: Int = 1,
        reps: Int? = null,
        weight: Double? = null,
        weightUnit: String? = "kg",
        distanceUnit: String? = null,
        plannedReps: Int? = null,
        plannedWeight: Double? = null,
    ) = ExerciseSetRow(
        id = id,
        exerciseName = "back_squat",
        category = "strength",
        setNumber = setNumber,
        reps = reps,
        weight = weight,
        weightUnit = weightUnit,
        distanceUnit = distanceUnit,
        plannedReps = plannedReps,
        plannedWeight = plannedWeight,
        version = 1,
    )

    private fun last(
        setNumber: Int,
        reps: Int? = null,
        weight: Double? = null,
        weightUnit: String? = "kg",
        distance: Double? = null,
        distanceUnit: String? = null,
        time: Double? = null,
    ) = GetExercisesByExerciseNameHistoryResponseItem(
        id = "h$setNumber",
        workoutLogId = "w0",
        exerciseName = "back_squat",
        category = "strength",
        setNumber = setNumber,
        reps = reps,
        weight = weight,
        weightUnit = weightUnit,
        distance = distance,
        distanceUnit = distanceUnit,
        time = time,
        date = "2026-11-01",
        version = 1,
    )

    @Test
    fun useLastFillsEachSetFromTheSameSetLastTimeAsFarAsBothGo() {
        val patches = useLastPatches(
            listOf(set("s1"), set("s2"), set("s3")),
            listOf(last(1, reps = 8, weight = 80.0), last(2, reps = 6, weight = 85.0)),
        )

        assertEquals(listOf("s1", "s2"), patches.map { it.first })
        assertEquals(Patch.of(8), patches[0].second.reps)
        assertEquals(Patch.of(85.0), patches[1].second.weight)
        assertEquals(Patch.Absent, patches[0].second.distance)
    }

    @Test
    fun aWeightLoggedInTheOtherUnitIsConvertedAndADistanceInAnotherUnitLeftAlone() {
        val (_, patch) = useLastPatches(
            listOf(set("s1", weightUnit = "kg", distanceUnit = "m")),
            listOf(last(1, weight = 220.0, weightUnit = "lbs", distance = 1000.0, distanceUnit = "ft")),
        ).single()

        assertEquals(99.79, (patch.weight as Patch.Value).value!!, 0.01)
        assertEquals(Patch.Absent, patch.distance)
    }

    @Test
    fun aSetLastTimeWithNothingToCopyIsSkipped() {
        assertEquals(emptyList(), useLastPatches(listOf(set("s1")), listOf(last(1))))
    }

    @Test
    fun changingTheExerciseKeepsTheValuesAndSetsTheNewOnesCategory() {
        val library = changeExercisePatch("wall_balls", null)
        assertEquals("wall_balls", library.exerciseName)
        assertEquals("functional", library.category)
        assertEquals(Patch.clear(), library.customLabel)
        assertEquals(Patch.Absent, library.reps)

        val custom = changeExercisePatch(CUSTOM_EXERCISE, "Sandbag carry")
        assertEquals(CUSTOM_EXERCISE, custom.exerciseName)
        assertEquals(CUSTOM_EXERCISE_CATEGORY, custom.category)
        assertEquals(Patch.of("Sandbag carry"), custom.customLabel)
    }

    @Test
    fun aPlannedDifferenceNamesWhatWasPlanned() {
        assertEquals(
            "planned 5 reps, 60 kg",
            plannedDiffSummary(listOf(set("s1", reps = 4, weight = 55.0, plannedReps = 5, plannedWeight = 60.0))),
        )
        assertEquals(
            "planned reps varied",
            plannedDiffSummary(listOf(set("s1", reps = 4, plannedReps = 5), set("s2", 2, reps = 4, plannedReps = 6))),
        )
        assertNull(plannedDiffSummary(listOf(set("s1", reps = 5, weight = 60.0, plannedReps = 5, plannedWeight = 60.0))))
        assertNull(plannedDiffSummary(listOf(set("s1", reps = 5))))
    }

    @Test
    fun deletingAnExerciseSaysWhatGoesWithIt() {
        assertEquals(
            "Back Squat and its set will be permanently removed from this workout.",
            deleteExerciseText(ExerciseGroup("back_squat", null, listOf(set("s1"))), "this workout"),
        )
        assertEquals(
            "Back Squat and all 2 sets will be permanently removed from this session.",
            deleteExerciseText(ExerciseGroup("back_squat", null, listOf(set("s1"), set("s2", 2))), "this session"),
        )
    }

    @Test
    fun historyKeepsLastTimesSetsForUseLast() {
        val history = exerciseHistory(
            listOf(last(2, reps = 6), last(1, reps = 8)),
            currentWorkoutId = "w9",
            category = "strength",
            exerciseName = "back_squat",
            defaultWeightUnit = "kg",
        )

        assertEquals(listOf(1, 2), history.lastSets.map { it.setNumber })
    }
}
