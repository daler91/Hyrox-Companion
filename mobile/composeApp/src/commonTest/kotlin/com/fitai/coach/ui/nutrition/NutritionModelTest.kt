package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionFoodServing
import com.fitai.coach.core.data.Meal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NutritionModelTest {
    private fun food(servingSizeG: Double?) = NutritionFood(
        id = "f1",
        source = NutritionFood.Source.entries.first(),
        name = "Oats",
        servingSizeG = servingSizeG,
        caloriesPer100g = 380.0,
        isPublic = true,
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-01T00:00:00Z",
    )

    private fun serving(label: String, grams: Double) = NutritionFoodServing(id = label, foodId = "f1", label = label, grams = grams)

    @Test
    fun unitsAreGramsThenServingsBySizeThenTheFoodsOwnServing() {
        val units = portionUnits(food(servingSizeG = 40.0), listOf(serving("cup", 80.0), serving("scoop", 30.0)))

        assertEquals(listOf("g", "scoop (30 g)", "cup (80 g)", "1 serving (40 g)"), units.map { it.label })
    }

    @Test
    fun theFoodsServingIsLeftOutWhenANamedOneIsThatSize() {
        val units = portionUnits(food(servingSizeG = 40.2), listOf(serving("bowl", 40.0)))

        assertEquals(listOf("g", "bowl (40 g)"), units.map { it.label })
    }

    @Test
    fun aNewEntryStartsAtOneServingElseAHundredGrams() {
        assertEquals(
            "scoop (30 g)" to 1.0,
            defaultPortion(portionUnits(food(null), listOf(serving("scoop", 30.0)))).let {
                it.first.label to
                    it.second
            },
        )
        assertEquals("g" to 100.0, defaultPortion(portionUnits(food(null), emptyList())).let { it.first.label to it.second })
    }

    @Test
    fun theMealFollowsTheClock() {
        assertEquals(Meal.Breakfast, mealForHour(10))
        assertEquals(Meal.Lunch, mealForHour(11))
        assertEquals(Meal.Dinner, mealForHour(20))
        assertEquals(Meal.Snack, mealForHour(21))
    }

    @Test
    fun progressClampsAndFlagsGoingOver() {
        assertEquals(0.5f, MacroProgress(1000.0, 2000.0).fraction)
        assertEquals(1f, MacroProgress(2500.0, 2000.0).fraction)
        assertTrue(MacroProgress(2500.0, 2000.0).over)
        assertFalse(MacroProgress(2000.0, 2000.0).over)
        assertNull(MacroProgress(500.0, null).fraction)
        assertNull(MacroProgress(500.0, 0.0).fraction)
    }

    // --- The day's tiles and a meal's bars ---

    private fun entryJson(name: String, grams: Int, calories: Double, protein: Double, carb: Double, fat: Double) =
        """{"id":"e-$name","foodId":"f-$name","name":"$name","loggedAt":"2026-11-15T12:00:00Z","logDate":"2026-11-15",""" +
            """"quantityG":$grams,"mealType":"lunch","entryMethod":"manual",""" +
            """"nutrition":{"calories":$calories,"protein":$protein,"carb":$carb,"fat":$fat,"fiber":0},"per100g":{}}"""

    private fun summary(target: Boolean) = ApiJson.decodeFromString(
        GetNutritionSummaryResponse.serializer(),
        """{"logDate":"2026-11-15","totals":{"calories":1225.6,"protein":92.3,"carb":159.8,"fat":22.8,"fiber":0},""" +
            """"meals":{"breakfast":[],"lunch":[${entryJson("Chicken", 180, 297.0, 55.8, 0.0, 6.4)},""" +
            """${entryJson(
                "Rice",
                250,
                325.0,
                6.8,
                70.0,
                0.8,
            )}],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}""" +
            if (target) {
                ""","effectiveTarget":{"calories":2600,"proteinG":150,"carbG":320,"fatG":80,"carbDeltaG":0,"baseLoadDeltaG":0,""" +
                    """"recoveryDeltaG":0,"preloadDeltaG":0,"proteinDeltaG":0,"utss":0,"scaled":false,"reasonCodes":[],""" +
                    """"explanation":""},""" +
                    """"mealTargets":{"lunch":{"calories":783,"proteinG":38,"carbG":95,"fatG":28,"role":"standard","reasonCodes":[],""" +
                    """"rationale":""}}}"""
            } else {
                "}"
            },
    )

    @Test
    fun theDaysTilesShowWholeNumbersAgainstTheirTargets() {
        val tiles = dayMacros(summary(target = true))
        assertEquals(listOf("Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)"), tiles.map { it.label })
        assertEquals(listOf("1226", "92", "160", "23", "0"), tiles.map { it.shown })
        assertEquals(listOf("1226 / 2600", "92 / 150", "160 / 320", "23 / 80", null), tiles.map { it.against })
        assertEquals("Calories 1226 of 2600", tiles.first().spoken)
        // Fibre has no target, and before any target is set no tile has one.
        assertEquals("Fiber (g) 0", tiles.last().spoken)
        assertTrue(dayMacros(summary(target = false)).all { it.against == null })
    }

    @Test
    fun aMealsBarsAddUpItsEntriesAgainstItsTarget() {
        val day = summary(target = true)
        val bars = mealMacros(day.entries(Meal.Lunch), day.target(Meal.Lunch)!!)
        assertEquals(listOf("Protein", "Carbs", "Fat"), bars.map { it.label })
        assertEquals(listOf("63/38g", "70/95g", "7/28g"), bars.map { it.against })
        assertEquals("Protein 63 of 38 grams", bars.first().spoken)
        // Over the meal's protein, under on the rest: the bar's colour follows the same ratio.
        assertEquals(listOf(true, false, false), bars.map { MacroProgress(it.logged, it.target).over })
    }

    @Test
    fun anEntryIsSummedUpInWholeNumbers() {
        assertEquals("180 g · 297 kcal · P 56 C 0 F 6", entrySummary(summary(target = true).entries(Meal.Lunch).first()))
    }
}
