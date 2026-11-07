package com.fitai.coach.core.nutrition

import com.fitai.coach.core.api.generated.NutritionMacroTotals
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * Numbers in and out of the fixture JSON for the nutrition ports. The harness
 * writes NaN and ±Infinity as the strings "NaN", "Infinity" and "-Infinity"
 * (script/mobile-fixtures/build.ts), in inputs and outputs alike.
 */

/** A JSON number, or one of the harness's strings for a non-finite number. */
internal fun JsonElement.jsDouble(): Double {
    val primitive = jsonPrimitive
    if (!primitive.isString) return primitive.double
    return when (primitive.content) {
        "NaN" -> Double.NaN
        "Infinity" -> Double.POSITIVE_INFINITY
        "-Infinity" -> Double.NEGATIVE_INFINITY
        else -> error("Not a fixture number: $primitive")
    }
}

/** [key] as a number; null when the key is absent (JS undefined) or null. */
internal fun JsonObject.jsDoubleOrNull(key: String): Double? = this[key]?.takeUnless { it is JsonNull }?.jsDouble()

internal fun JsonObject.jsDouble(key: String): Double = getValue(key).jsDouble()

/** A number as the harness writes it: finite as a JSON number, NaN and ±Infinity as strings. */
internal fun jsNumber(x: Double): JsonPrimitive = when {
    x.isNaN() -> JsonPrimitive("NaN")
    x == Double.POSITIVE_INFINITY -> JsonPrimitive("Infinity")
    x == Double.NEGATIVE_INFINITY -> JsonPrimitive("-Infinity")
    else -> JsonPrimitive(x)
}

internal fun JsonElement.toMacroTotals(): NutritionMacroTotals {
    val o = jsonObject
    return NutritionMacroTotals(
        calories = o.jsDouble("calories"),
        protein = o.jsDouble("protein"),
        carb = o.jsDouble("carb"),
        fat = o.jsDouble("fat"),
        fiber = o.jsDouble("fiber"),
    )
}

internal fun NutritionMacroTotals.toJson(): JsonObject = buildJsonObject {
    put("calories", jsNumber(calories))
    put("protein", jsNumber(protein))
    put("carb", jsNumber(carb))
    put("fat", jsNumber(fat))
    put("fiber", jsNumber(fiber))
}
