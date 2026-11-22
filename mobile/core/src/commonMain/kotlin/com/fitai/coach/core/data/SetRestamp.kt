package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.units.StampedSetPatch
import com.fitai.coach.core.units.StampedSetValues
import com.fitai.coach.core.units.UnitPreferences
import com.fitai.coach.core.units.restampSetPatch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/**
 * A set PATCH [body] as the server will apply it to the stored row [rowJson]
 * (storage's restampSetPatch): the patch's numbers are in the units it names
 * (`weightUnit` / `distanceUnit`), so each axis it touches takes that unit's
 * stamp, and the row's other value on that axis is converted from the old
 * stamp. The named units themselves are a preference ("km"), not a stamp
 * ("m"), so they never reach the row as sent. A patch that names no unit
 * applies as it is.
 *
 * It keeps the device's copy of a set true from the edit until the server's
 * answer replaces it, as the web's optimistic update does (tech debt #63).
 */
internal fun restampedSetBody(rowJson: String, patch: PatchWorkoutsByIdSetsBySetIdRequest, body: String): String {
    val namesUnits = patch.weightUnit != null || patch.distanceUnit != null
    val row = if (namesUnits) decodeOrNull(ExerciseSetRow.serializer(), rowJson) else null
    return row?.let { restamped(it, patch, body) } ?: body
}

private fun restamped(row: ExerciseSetRow, patch: PatchWorkoutsByIdSetsBySetIdRequest, body: String): String {
    val restamped = restampSetPatch(
        existing = StampedSetValues(
            weight = row.weight,
            plannedWeight = row.plannedWeight,
            distance = row.distance,
            plannedDistance = row.plannedDistance,
            weightUnit = row.weightUnit,
            distanceUnit = row.distanceUnit,
        ),
        // An axis whose unit the patch doesn't name keeps its stamp, as on the server.
        patch = StampedSetPatch(
            weight = if (patch.weightUnit == null) Patch.Absent else patch.weight,
            distance = if (patch.distanceUnit == null) Patch.Absent else patch.distance,
        ),
        preferences = UnitPreferences(weightUnit = patch.weightUnit?.wireValue, distanceUnit = patch.distanceUnit?.wireValue),
    )
    val fields = ApiJson.parseToJsonElement(body).jsonObject.toMutableMap()
    fields.remove("weightUnit")
    fields.remove("distanceUnit")
    fields.putNumber("weight", restamped.weight)
    fields.putNumber("plannedWeight", restamped.plannedWeight)
    fields.putNumber("distance", restamped.distance)
    fields.putNumber("plannedDistance", restamped.plannedDistance)
    fields.putText("weightUnit", restamped.weightUnit)
    fields.putText("distanceUnit", restamped.distanceUnit)
    return JsonObject(fields).toString()
}

private fun MutableMap<String, JsonElement>.putNumber(name: String, value: Patch<Double>) {
    if (value is Patch.Value) this[name] = JsonPrimitive(value.value)
}

private fun MutableMap<String, JsonElement>.putText(name: String, value: Patch<String>) {
    if (value is Patch.Value) this[name] = JsonPrimitive(value.value)
}
