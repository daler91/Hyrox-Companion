package com.fitai.coach.core.nutrition

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test

class NutritionScalingFixtureTest {
    private fun JsonElement.toPer100g(): Per100gMacros {
        val o = jsonObject
        return Per100gMacros(
            caloriesPer100g = o.jsDoubleOrNull("caloriesPer100g"),
            proteinPer100g = o.jsDoubleOrNull("proteinPer100g"),
            carbPer100g = o.jsDoubleOrNull("carbPer100g"),
            fatPer100g = o.jsDoubleOrNull("fatPer100g"),
            fiberPer100g = o.jsDoubleOrNull("fiberPer100g"),
        )
    }

    @Test
    fun kcalPerGSuite() = assertFixtureSuite("nutritionScaling.KCAL_PER_G") {
        buildJsonObject {
            put("KCAL_PER_G_PROTEIN", jsNumber(KCAL_PER_G_PROTEIN))
            put("KCAL_PER_G_CARB", jsNumber(KCAL_PER_G_CARB))
            put("KCAL_PER_G_FAT", jsNumber(KCAL_PER_G_FAT))
            put(
                "KCAL_PER_G",
                buildJsonObject {
                    put("protein", jsNumber(KCAL_PER_G.protein))
                    put("carb", jsNumber(KCAL_PER_G.carb))
                    put("fat", jsNumber(KCAL_PER_G.fat))
                },
            )
        }
    }

    @Test
    fun emptyTotalsSuite() = assertFixtureSuite("nutritionScaling.emptyTotals") { emptyTotals().toJson() }

    @Test
    fun scaleNutritionSuite() = assertFixtureSuite("nutritionScaling.scaleNutrition") { input ->
        val o = input.jsonObject
        scaleNutrition(o.getValue("food").toPer100g(), o.jsDouble("quantityG")).toJson()
    }

    @Test
    fun roundMacrosSuite() = assertFixtureSuite("nutritionScaling.roundMacros") { input ->
        roundMacros(input.toMacroTotals()).toJson()
    }

    @Test
    fun addIntoSuite() = assertFixtureSuite("nutritionScaling.addInto") { input ->
        val o = input.jsonObject
        o.getValue("addends").jsonArray
            .fold(o.getValue("acc").toMacroTotals()) { acc, n -> addInto(acc, n.toMacroTotals()) }
            .toJson()
    }

    @Test
    fun totalNutritionSuite() = assertFixtureSuite("nutritionScaling.totalNutrition") { input ->
        val rows = input.jsonArray.map {
            val row = it.jsonObject
            FoodPortion(per100g = row.getValue("per100g").toPer100g(), quantityG = row.jsDouble("quantityG"))
        }
        totalNutrition(rows).toJson()
    }
}
