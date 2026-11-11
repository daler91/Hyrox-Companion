package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionMealType
import com.fitai.coach.core.api.generated.NutritionParseMealResponse
import com.fitai.coach.core.api.generated.NutritionParseMealResponse.ItemsItem
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.data.MealEntryMethod
import com.fitai.coach.core.data.MealItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MealReviewModelTest {
    private val egg = NutritionFood(
        id = "f1",
        source = NutritionFood.Source.Usda,
        name = "Egg, scrambled",
        caloriesPer100g = 150.0,
        isPublic = true,
        createdAt = "2026-11-01T00:00:00Z",
        updatedAt = "2026-11-01T00:00:00Z",
    )

    private val parsed = NutritionParseMealResponse(
        items = listOf(
            ItemsItem("scrambled eggs", 120.5, "2 scrambled eggs", NutritionMealType.Breakfast, 0.9, "f1", egg),
            ItemsItem("mystery sauce", 30.2, "", null, 0.3),
        ),
        warnings = emptyList(),
        rawInput = "2 scrambled eggs and a splash of mystery sauce",
    )

    @Test
    fun rowsRoundTheGramsAndPutAMeallessItemInTheMealForNow() {
        val rows = reviewRows(parsed, fallback = Meal.Lunch)
        // Math.round: half rounds up.
        assertEquals(listOf("121", "30"), rows.map { it.grams })
        assertEquals(listOf(Meal.Breakfast, Meal.Lunch), rows.map { it.meal })
        // No display amount: the item's name stands in.
        assertEquals("mystery sauce", rows[1].displayAmount)
        assertEquals(listOf("0-scrambled eggs", "1-mystery sauce"), rows.map { it.key })
    }

    @Test
    fun onlyRowsWithAMatchAndGramsAreLogged() {
        val review = MealReview(MealEntryMethod.Described, parsed.rawInput, emptyList(), reviewRows(parsed, Meal.Lunch))
        assertEquals(1, review.loggable.size)
        assertEquals(1, review.unresolved)
        assertEquals(listOf(MealItem("f1", 121.0, Meal.Breakfast, 0.9)), review.items())
        val cleared = review.copy(rows = review.rows.map { it.copy(grams = "") })
        assertTrue(cleared.items().isEmpty())
        assertFalse(review.rows[0].copy(grams = "0").loggable)
    }

    @Test
    fun theLabelsCountTheItems() {
        assertEquals("Log 1 item", logItemsLabel(1))
        assertEquals("Log 3 items", logItemsLabel(3))
        assertNull(unresolvedNote(0))
        assertEquals("1 item needs a match and won't be logged.", unresolvedNote(1))
        assertEquals("2 items need a match and won't be logged.", unresolvedNote(2))
        assertEquals("Logged 1 item", loggedItemsToast(1))
        assertEquals("Logged 4 items", loggedItemsToast(4))
    }
}
