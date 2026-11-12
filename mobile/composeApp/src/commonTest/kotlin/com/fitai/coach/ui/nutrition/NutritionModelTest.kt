package com.fitai.coach.ui.nutrition

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
}
