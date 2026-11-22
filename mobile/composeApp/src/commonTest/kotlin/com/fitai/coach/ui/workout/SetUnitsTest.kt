package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdSetsRequest
import com.fitai.coach.core.units.UnitPreferences
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Tech debt #63: the set editor showed and sent a set in the unit stamped on
 * its row, while the server reads an edit's numbers as the athlete's current
 * units, so saving an older set after a kg/lbs switch relabelled 225 lbs as
 * 225 kg. The screens now show sets in the current units and every write names
 * them, as the web does.
 */
class SetUnitsTest {
    private val metric = UnitPreferences(weightUnit = "kg", distanceUnit = "km")
    private val imperial = UnitPreferences(weightUnit = "lbs", distanceUnit = "miles")

    private fun set(weight: Double?, distance: Double?, weightUnit: String?, distanceUnit: String?) = ExerciseSetRow(
        id = "s1",
        exerciseName = "back_squat",
        category = "strength",
        setNumber = 1,
        weight = weight,
        plannedWeight = weight,
        distance = distance,
        plannedDistance = distance,
        weightUnit = weightUnit,
        distanceUnit = distanceUnit,
        version = 1,
    )

    @Test
    fun aSetStampedInTheOtherUnitsReadsInTheAthletesUnits() {
        val shown = set(weight = 225.0, distance = 1000.0, weightUnit = "lbs", distanceUnit = "ft").toPreferenceScale(metric)

        // 225 lb is 102.06 kg (to the nearest half kilo); 1000 ft is 304.8 m (to the metre).
        assertEquals(102.0, shown.weight)
        assertEquals(102.0, shown.plannedWeight)
        assertEquals(305.0, shown.distance)
        assertEquals(305.0, shown.plannedDistance)
        assertEquals("kg", shown.weightUnit)
        assertEquals("m", shown.distanceUnit)
    }

    @Test
    fun aSetAlreadyInTheAthletesUnitsIsUnchanged() {
        val stored = set(weight = 100.0, distance = 400.0, weightUnit = "kg", distanceUnit = "m")

        assertEquals(stored, stored.toPreferenceScale(metric))
    }

    @Test
    fun aLegacySetKeepsItsValuesAndTakesTheCurrentStamp() {
        val shown = set(weight = 135.0, distance = null, weightUnit = null, distanceUnit = null).toPreferenceScale(imperial)

        assertEquals(135.0, shown.weight)
        assertNull(shown.distance)
        assertEquals("lbs", shown.weightUnit)
        assertEquals("ft", shown.distanceUnit)
    }

    @Test
    fun anEditNamesTheUnitsOfTheAxesItTouches() {
        val edit = PatchWorkoutsByIdSetsBySetIdRequest(reps = Patch.of(5), weight = Patch.of(225.0), distance = Patch.clear())
            .composedIn(imperial)

        assertEquals(PatchWorkoutsByIdSetsBySetIdRequest.WeightUnit.Lbs, edit.weightUnit)
        assertEquals(PatchWorkoutsByIdSetsBySetIdRequest.DistanceUnit.Miles, edit.distanceUnit)
    }

    @Test
    fun anEditThatLeavesAnAxisAloneNamesNoUnitForIt() {
        val repsOnly = PatchWorkoutsByIdSetsBySetIdRequest(reps = Patch.of(5)).composedIn(imperial)
        val weightOnly = PatchPlansDaysByDayIdSetsBySetIdRequest(weight = Patch.of(60.0)).composedIn(metric)

        assertNull(repsOnly.weightUnit)
        assertNull(repsOnly.distanceUnit)
        assertEquals(PatchPlansDaysByDayIdSetsBySetIdRequest.WeightUnit.Kg, weightOnly.weightUnit)
        assertNull(weightOnly.distanceUnit)
    }

    @Test
    fun aNewSetNamesBothUnits() {
        val added = PostWorkoutsByIdSetsRequest(exerciseName = "back_squat", category = "strength", setNumber = 2)
            .composedIn(UnitPreferences())

        assertEquals(PostWorkoutsByIdSetsRequest.WeightUnit.Kg, added.weightUnit)
        assertEquals(PostWorkoutsByIdSetsRequest.DistanceUnit.Km, added.distanceUnit)
    }
}
