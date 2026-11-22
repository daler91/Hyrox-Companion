package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryResponseItem
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PostPlansDaysByDayIdSetsRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdSetsRequest
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.units.StoredUnitStamp
import com.fitai.coach.core.units.UnitPreferences
import com.fitai.coach.core.units.stampForPreferences
import com.fitai.coach.core.units.standardizeDistanceUnit
import com.fitai.coach.core.units.standardizeWeightUnit
import com.fitai.coach.core.units.storedDistanceToDisplay
import com.fitai.coach.core.units.storedWeightToDisplay

/*
 * Sets in the athlete's current units (tech debt #63). The server reads a set
 * write's numbers as the units the request names, else the athlete's current
 * preference, and re-stamps the row to match (restampSetPatch, D22). The
 * screens used to show and send a set in the unit stamped on its row, so after
 * a kg/lbs switch saving an older set relabelled 225 lbs as 225 kg. As on the
 * web: sets are converted once where they enter a screen
 * (client/src/lib/setDisplay.ts toPreferenceScale), so every value shown,
 * edited or copied is in the current units, and every write names the units
 * its numbers are in (useExerciseSetsForOwner's composedUnitsFor).
 */

/** The athlete's units as the unit ports read them; an unset preference reads as kg and km. */
fun PreferencesResponse?.units(): UnitPreferences = UnitPreferences(weightUnit = this?.weightUnit, distanceUnit = this?.distanceUnit)

/** A row's stamped values, re-expressed in [units], with the stamp they now carry. */
private data class Scaled(
    val weight: Double?,
    val plannedWeight: Double?,
    val distance: Double?,
    val plannedDistance: Double?,
    val weightUnit: String,
    val distanceUnit: String,
)

@Suppress("LongParameterList")
private fun scaled(
    weight: Double?,
    plannedWeight: Double?,
    distance: Double?,
    plannedDistance: Double?,
    stamp: StoredUnitStamp,
    units: UnitPreferences,
): Scaled {
    val current = stampForPreferences(units)
    return Scaled(
        weight = weight?.let { storedWeightToDisplay(it, stamp, units) },
        plannedWeight = plannedWeight?.let { storedWeightToDisplay(it, stamp, units) },
        distance = distance?.let { storedDistanceToDisplay(it, stamp, units) },
        plannedDistance = plannedDistance?.let { storedDistanceToDisplay(it, stamp, units) },
        weightUnit = current.weightUnit.wireValue,
        distanceUnit = current.distanceUnit.wireValue,
    )
}

/**
 * A stored set in the athlete's current units: a row stamped in another unit
 * is converted (and rounded) from it, a legacy unstamped row keeps its values,
 * and either way it carries the current stamp, so converting twice changes
 * nothing. Port of the web's toPreferenceScale.
 */
fun ExerciseSetRow.toPreferenceScale(units: UnitPreferences): ExerciseSetRow {
    val values = scaled(weight, plannedWeight, distance, plannedDistance, StoredUnitStamp(weightUnit, distanceUnit), units)
    return copy(
        weight = values.weight,
        plannedWeight = values.plannedWeight,
        distance = values.distance,
        plannedDistance = values.plannedDistance,
        weightUnit = values.weightUnit,
        distanceUnit = values.distanceUnit,
    )
}

/** A set from an exercise's history in the athlete's current units, for last time, Use last and the next target. */
fun GetExercisesByExerciseNameHistoryResponseItem.toPreferenceScale(units: UnitPreferences): GetExercisesByExerciseNameHistoryResponseItem {
    val values = scaled(weight, plannedWeight, distance, plannedDistance, StoredUnitStamp(weightUnit, distanceUnit), units)
    return copy(
        weight = values.weight,
        plannedWeight = values.plannedWeight,
        distance = values.distance,
        plannedDistance = values.plannedDistance,
        weightUnit = values.weightUnit,
        distanceUnit = values.distanceUnit,
    )
}

private fun weightWire(units: UnitPreferences): String = standardizeWeightUnit(units.weightUnit).wireValue

private fun distanceWire(units: UnitPreferences): String = standardizeDistanceUnit(units.distanceUnit).wireValue

/**
 * The update with the units its numbers were composed in, for each axis it
 * touches; an axis it leaves alone names none, so the server leaves its stamp.
 */
fun PatchWorkoutsByIdSetsBySetIdRequest.composedIn(units: UnitPreferences): PatchWorkoutsByIdSetsBySetIdRequest = copy(
    weightUnit = if (weight is Patch.Absent) {
        weightUnit
    } else {
        PatchWorkoutsByIdSetsBySetIdRequest.WeightUnit.entries.first { it.wireValue == weightWire(units) }
    },
    distanceUnit = if (distance is Patch.Absent) {
        distanceUnit
    } else {
        PatchWorkoutsByIdSetsBySetIdRequest.DistanceUnit.entries.first { it.wireValue == distanceWire(units) }
    },
)

/** [PatchWorkoutsByIdSetsBySetIdRequest.composedIn] for a plan day's prescribed set. */
fun PatchPlansDaysByDayIdSetsBySetIdRequest.composedIn(units: UnitPreferences): PatchPlansDaysByDayIdSetsBySetIdRequest = copy(
    weightUnit = if (weight is Patch.Absent) {
        weightUnit
    } else {
        PatchPlansDaysByDayIdSetsBySetIdRequest.WeightUnit.entries.first { it.wireValue == weightWire(units) }
    },
    distanceUnit = if (distance is Patch.Absent) {
        distanceUnit
    } else {
        PatchPlansDaysByDayIdSetsBySetIdRequest.DistanceUnit.entries.first { it.wireValue == distanceWire(units) }
    },
)

/** A new set, stamped on both axes, so it names both units. */
fun PostWorkoutsByIdSetsRequest.composedIn(units: UnitPreferences): PostWorkoutsByIdSetsRequest = copy(
    weightUnit = PostWorkoutsByIdSetsRequest.WeightUnit.entries.first { it.wireValue == weightWire(units) },
    distanceUnit = PostWorkoutsByIdSetsRequest.DistanceUnit.entries.first { it.wireValue == distanceWire(units) },
)

/** A new prescribed set, stamped on both axes, so it names both units. */
fun PostPlansDaysByDayIdSetsRequest.composedIn(units: UnitPreferences): PostPlansDaysByDayIdSetsRequest = copy(
    weightUnit = PostPlansDaysByDayIdSetsRequest.WeightUnit.entries.first { it.wireValue == weightWire(units) },
    distanceUnit = PostPlansDaysByDayIdSetsRequest.DistanceUnit.entries.first { it.wireValue == distanceWire(units) },
)
