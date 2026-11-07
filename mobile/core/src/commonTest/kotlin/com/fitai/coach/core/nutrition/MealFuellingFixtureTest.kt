package com.fitai.coach.core.nutrition

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test

class MealFuellingFixtureTest {
    @Test
    fun mergeMealOverrideSuite() = assertFixtureSuite("mealFuelling.mergeMealOverride") { input ->
        val split = input.jsonObject.getValue("split").jsonObject
        val override = input.jsonObject.getValue("override").jsonObject
        val merged = mergeMealOverride(
            split = MealFuelValues(
                calories = split.jsDouble("calories"),
                carbG = split.jsDouble("carbG"),
                proteinG = split.jsDouble("proteinG"),
                fatG = split.jsDouble("fatG"),
            ),
            ov = MealFuelOverride(
                calories = override.jsDoubleOrNull("calories"),
                carbG = override.jsDoubleOrNull("carbG"),
                proteinG = override.jsDoubleOrNull("proteinG"),
                fatG = override.jsDoubleOrNull("fatG"),
            ),
        )
        buildJsonObject {
            put("carbG", jsNumber(merged.carbG))
            put("proteinG", jsNumber(merged.proteinG))
            put("fatG", jsNumber(merged.fatG))
            put("calories", jsNumber(merged.calories))
            put("caloriesFromMacros", JsonPrimitive(merged.caloriesFromMacros))
        }
    }
}
