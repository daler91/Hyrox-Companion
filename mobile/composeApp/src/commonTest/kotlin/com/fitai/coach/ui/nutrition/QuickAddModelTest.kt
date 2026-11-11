package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionFoodWithPortionMemory
import com.fitai.coach.core.api.generated.NutritionMealType
import com.fitai.coach.core.data.Meal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QuickAddModelTest {
    private fun food(id: String, grams: Double? = null, meal: NutritionMealType? = null, name: String = "Oats") =
        NutritionFoodWithPortionMemory(
            id = id,
            source = NutritionFoodWithPortionMemory.Source.Usda,
            name = name,
            isPublic = true,
            createdAt = "2026-11-01T00:00:00Z",
            updatedAt = "2026-11-01T00:00:00Z",
            lastQuantityG = grams,
            lastMealType = meal,
        )

    @Test
    fun aFoodsPortionIsRememberedFromEitherListAndAFavouriteWinsATie() {
        val state = QuickAddState(
            recent = listOf(food("f1", 50.0, NutritionMealType.Snack), food("f2", 120.0, NutritionMealType.Lunch), food("f3")),
            favorites = listOf(food("f1", 80.0, NutritionMealType.Breakfast)),
        )

        assertEquals(
            mapOf("f1" to PortionHint(80.0, Meal.Breakfast), "f2" to PortionHint(120.0, Meal.Lunch)),
            state.portions,
        )
    }

    @Test
    fun itsTheFirstRunOnlyWhenBothListsHaveLoadedEmpty() {
        assertFalse(QuickAddState().firstRun)
        assertFalse(QuickAddState(recent = emptyList()).firstRun)
        assertTrue(QuickAddState(recent = emptyList(), favorites = emptyList()).firstRun)
        assertFalse(QuickAddState(recent = listOf(food("f1")), favorites = emptyList()).firstRun)
    }

    @Test
    fun theChipsShowOnceEitherListHasAFood() {
        assertFalse(QuickAddState().hasFoods)
        assertFalse(QuickAddState(recent = emptyList(), favorites = emptyList()).hasFoods)
        assertTrue(QuickAddState(favorites = listOf(food("f1"))).hasFoods)
    }

    @Test
    fun aFavouriteLogsInOneTapOnlyOnceItHasAPortion() {
        assertNull(food("f1").quickLogItem())
        assertNull(food("f1", grams = 80.0).quickLogItem())
        assertEquals(QuickLogItem("f1", "Oats", 80.0, Meal.SnackPm), food("f1", 80.0, NutritionMealType.SnackPm).quickLogItem())
    }

    @Test
    fun theToastsNameWhatWasDone() {
        assertEquals("Logged Oats · 81 g · Breakfast", quickLoggedMessage(QuickLogItem("f1", "Oats", 80.6, Meal.Breakfast)))
        assertEquals("Repeated 1 item", repeatedMessage(1))
        assertEquals("Repeated 3 items", repeatedMessage(3))
    }

    @Test
    fun aLongNameIsCutShortOnItsChip() {
        assertEquals("Oats", chipLabel("Oats"))
        assertEquals("Greek yoghurt, full fat …", chipLabel("Greek yoghurt, full fat (Fage)"))
    }

    @Test
    fun aQuickAddFoodOpensTheLogSheetAsAFood() {
        val opened = food("f1", 80.0, NutritionMealType.Breakfast).copy(servingSizeG = 40.0, caloriesPer100g = 380.0).toFood()

        assertEquals("f1", opened.id)
        assertEquals(NutritionFood.Source.Usda, opened.source)
        assertEquals(40.0, opened.servingSizeG)
        assertEquals(380.0, opened.caloriesPer100g)
    }
}
