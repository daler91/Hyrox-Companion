package com.fitai.coach.core.units

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test

/**
 * Pins UnitConversion.kt to shared/unitConversion.ts through the
 * `unitConversion.*` golden fixtures (script/mobile-fixtures/suites/unitConversion.ts).
 * Each test decodes the TS input, calls the port, and encodes the result as
 * the TS serialises it: NaN and infinities as strings, undefined keys left
 * out, null as null. `{"notAUnit": true}` is where the TS yields no unit and
 * the port throws [UnitAliasException].
 */
class UnitConversionFixtureTest {
    @Test
    fun standardizeWeightUnit() = assertFixtureSuite("unitConversion.standardizeWeightUnit") { input ->
        notAUnitOnAliasError { JsonPrimitive(standardizeWeightUnit(input.unit).wireValue) }
    }

    @Test
    fun standardizeDistanceUnit() = assertFixtureSuite("unitConversion.standardizeDistanceUnit") { input ->
        notAUnitOnAliasError { JsonPrimitive(standardizeDistanceUnit(input.unit).wireValue) }
    }

    @Test
    fun standardizeParsedDistanceUnit() = assertFixtureSuite("unitConversion.standardizeParsedDistanceUnit") { input ->
        notAUnitOnAliasError { JsonPrimitive(standardizeParsedDistanceUnit(input.unit)?.wireValue) }
    }

    @Test
    fun getStoredDistanceUnit() = assertFixtureSuite("unitConversion.getStoredDistanceUnit") { input ->
        JsonPrimitive(getStoredDistanceUnit(input.unit).wireValue)
    }

    @Test
    fun convertWeight() = assertFixtureSuite("unitConversion.convertWeight") { input ->
        val (value, from, to) = input.jsonArray
        number(convertWeight(value.number, from.unit, to.unit))
    }

    @Test
    fun kgToUserWeight() = assertFixtureSuite("unitConversion.kgToUserWeight") { input ->
        val (kg, unit) = input.jsonArray
        number(kgToUserWeight(kg.number, unit.unit))
    }

    @Test
    fun userWeightToKg() = assertFixtureSuite("unitConversion.userWeightToKg") { input ->
        val (value, unit) = input.jsonArray
        number(userWeightToKg(value.number, unit.unit))
    }

    @Test
    fun metersToUserDistance() = assertFixtureSuite("unitConversion.metersToUserDistance") { input ->
        val (meters, unit) = input.jsonArray
        number(metersToUserDistance(meters.number, unit.unit))
    }

    @Test
    fun userDistanceToMeters() = assertFixtureSuite("unitConversion.userDistanceToMeters") { input ->
        val (value, unit) = input.jsonArray
        number(userDistanceToMeters(value.number, unit.unit))
    }

    @Test
    fun cmToFtIn() = assertFixtureSuite("unitConversion.cmToFtIn") { input ->
        val height = cmToFtIn(input.number)
        JsonObject(mapOf("feet" to number(height.feet), "inches" to number(height.inches)))
    }

    @Test
    fun ftInToCm() = assertFixtureSuite("unitConversion.ftInToCm") { input ->
        val (feet, inches) = input.jsonArray
        number(ftInToCm(feet.number, inches.number))
    }

    @Test
    fun roundStoredWeight() = assertFixtureSuite("unitConversion.roundStoredWeight") { input ->
        val (value, unit) = input.jsonArray
        number(roundStoredWeight(value.number, unit.unit))
    }

    @Test
    fun roundStoredDistance() = assertFixtureSuite("unitConversion.roundStoredDistance") { input ->
        number(roundStoredDistance(input.number))
    }

    @Test
    fun stampForPreferences() = assertFixtureSuite("unitConversion.stampForPreferences") { input ->
        notAUnitOnAliasError {
            val stamp = stampForPreferences(input.preferences)
            buildJsonObject {
                put("weightUnit", stamp.weightUnit.wireValue)
                put("distanceUnit", stamp.distanceUnit.wireValue)
            }
        }
    }

    @Test
    fun storedWeightToDisplay() = assertFixtureSuite("unitConversion.storedWeightToDisplay") { input ->
        val case = StampedCase(input)
        notAUnitOnAliasError { number(storedWeightToDisplay(case.value, case.stamp, case.preferences)) }
    }

    @Test
    fun storedDistanceToDisplay() = assertFixtureSuite("unitConversion.storedDistanceToDisplay") { input ->
        val case = StampedCase(input)
        number(storedDistanceToDisplay(case.value, case.stamp, case.preferences))
    }

    @Test
    fun restampSetPatch() = assertFixtureSuite("unitConversion.restampSetPatch") { input ->
        val case = input.jsonObject
        val existing = case.getValue("existing").jsonObject
        val patch = case.getValue("patch").jsonObject
        notAUnitOnAliasError {
            val out = restampSetPatch(
                existing = StampedSetValues(
                    weight = existing.optionalNumber("weight"),
                    plannedWeight = existing.optionalNumber("plannedWeight"),
                    distance = existing.optionalNumber("distance"),
                    plannedDistance = existing.optionalNumber("plannedDistance"),
                    weightUnit = existing.optionalString("weightUnit"),
                    distanceUnit = existing.optionalString("distanceUnit"),
                ),
                patch = StampedSetPatch(
                    weight = patch.numberPatch("weight"),
                    plannedWeight = patch.numberPatch("plannedWeight"),
                    distance = patch.numberPatch("distance"),
                    plannedDistance = patch.numberPatch("plannedDistance"),
                    weightUnit = patch.stringPatch("weightUnit"),
                    distanceUnit = patch.stringPatch("distanceUnit"),
                ),
                preferences = case.getValue("preferences").preferences,
            )
            // The rest of the update (reps, notes, …) is not the port's business: it passes through as in the TS spread.
            val passThrough = patch.filterKeys { it !in STAMPED_FIELDS }
            val stamped = listOf(
                "weight" to out.weight.toJson(::number),
                "plannedWeight" to out.plannedWeight.toJson(::number),
                "distance" to out.distance.toJson(::number),
                "plannedDistance" to out.plannedDistance.toJson(::number),
                "weightUnit" to out.weightUnit.toJson(::JsonPrimitive),
                "distanceUnit" to out.distanceUnit.toJson(::JsonPrimitive),
            ).mapNotNull { (key, value) -> value?.let { key to it } }
            JsonObject(passThrough + stamped)
        }
    }

    @Test
    fun getWorkoutDistanceDisplay() = assertFixtureSuite("unitConversion.getWorkoutDistanceDisplay") { input ->
        val (value, unit) = input.jsonArray
        val display = getWorkoutDistanceDisplay(value.number, unit.unit)
        JsonObject(
            mapOf(
                "value" to number(display.value),
                "unit" to JsonPrimitive(display.unit.wireValue),
                "text" to JsonPrimitive(display.text),
            ),
        )
    }

    @Test
    fun displayDistanceToStored() = assertFixtureSuite("unitConversion.displayDistanceToStored") { input ->
        val (value, displayUnit, unit) = input.jsonArray
        val shownIn = WorkoutDistanceDisplayUnit.entries.single { it.wireValue == displayUnit.jsonPrimitive.content }
        number(displayDistanceToStored(value.number, shownIn, unit.unit))
    }
}

private val STAMPED_FIELDS = setOf("weight", "plannedWeight", "distance", "plannedDistance", "weightUnit", "distanceUnit")

private val NOT_A_UNIT = buildJsonObject { put("notAUnit", true) }

private fun notAUnitOnAliasError(port: () -> JsonElement): JsonElement = try {
    port()
} catch (_: UnitAliasException) {
    NOT_A_UNIT
}

/** A fixture number; NaN and the infinities are written as strings. */
private val JsonElement.number: Double
    get() {
        val primitive = jsonPrimitive
        if (!primitive.isString) return primitive.content.toDouble()
        return when (primitive.content) {
            "NaN" -> Double.NaN
            "Infinity" -> Double.POSITIVE_INFINITY
            "-Infinity" -> Double.NEGATIVE_INFINITY
            else -> error("Not a fixture number: $primitive")
        }
    }

/** A port result as the fixture writes it. */
private fun number(value: Double): JsonPrimitive = when {
    value.isNaN() -> JsonPrimitive("NaN")
    value == Double.POSITIVE_INFINITY -> JsonPrimitive("Infinity")
    value == Double.NEGATIVE_INFINITY -> JsonPrimitive("-Infinity")
    else -> JsonPrimitive(value)
}

/** A unit string argument; JSON null is null. */
private val JsonElement.unit: String?
    get() = if (this is JsonNull) null else jsonPrimitive.content

private fun JsonObject.optionalString(key: String): String? = this[key]?.unit

private fun JsonObject.optionalNumber(key: String): Double? = this[key]?.let { if (it is JsonNull) null else it.number }

/** Absent and null unit keys both mean "not set", as in the TS. */
private val JsonElement.preferences: UnitPreferences
    get() = with(jsonObject) {
        UnitPreferences(weightUnit = optionalString("weightUnit"), distanceUnit = optionalString("distanceUnit"))
    }

private val JsonElement.stamp: StoredUnitStamp
    get() = with(jsonObject) {
        StoredUnitStamp(weightUnit = optionalString("weightUnit"), distanceUnit = optionalString("distanceUnit"))
    }

/** A `{value, stamp, preferences}` case of the stored*ToDisplay suites. */
private class StampedCase(input: JsonElement) {
    private val fields = input.jsonObject
    val value: Double = fields.getValue("value").number
    val stamp: StoredUnitStamp = fields.getValue("stamp").stamp
    val preferences: UnitPreferences = fields.getValue("preferences").preferences
}

/** An absent key is TS undefined ([Patch.Absent]); null is an explicit null. */
private fun JsonObject.numberPatch(key: String): Patch<Double> = when (val value = this[key]) {
    null -> Patch.Absent
    JsonNull -> Patch.clear()
    else -> Patch.of(value.number)
}

private fun JsonObject.stringPatch(key: String): Patch<String> = when (val value = this[key]) {
    null -> Patch.Absent
    JsonNull -> Patch.clear()
    else -> Patch.of(value.jsonPrimitive.content)
}

/** The JSON a patch field becomes: none for [Patch.Absent] (JSON.stringify drops undefined), null for a null. */
private fun <T : Any> Patch<T>.toJson(encode: (T) -> JsonElement): JsonElement? = when (this) {
    Patch.Absent -> null
    is Patch.Value -> value?.let(encode) ?: JsonNull
}
