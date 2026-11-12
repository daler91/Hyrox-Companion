package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.data.CustomFoodDraft
import com.fitai.coach.core.data.Portion
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MyFoodsModelTest {
    @Test
    fun aBlankOrUnreadableFigureIsSavedAsUnknown() {
        val sheet = CustomFoodSheetState(
            name = "  Granola ",
            brand = "  ",
            calories = "450",
            protein = "10.5",
            carb = "-3",
            fat = "lots",
            fiber = "",
            servingSize = " 45 ",
        )

        assertEquals(CustomFoodDraft("Granola", null, 450.0, 10.5, null, null, null, 45.0), sheet.draft())
    }

    @Test
    fun aFoodNeedsAName() {
        assertFalse(CustomFoodSheetState(name = " ").valid)
        assertTrue(CustomFoodSheetState(name = "Granola").valid)
    }

    @Test
    fun onlyPortionsWithALabelAndAWeightAreSaved() {
        val sheet = CustomFoodSheetState(
            portions = listOf(
                PortionDraft(" 1 bowl ", "60"),
                PortionDraft("", "30"),
                PortionDraft("a pinch", "0"),
                PortionDraft("a cup", "x"),
            ),
        )

        assertEquals(listOf(Portion("1 bowl", 60.0)), sheet.completePortions())
        assertNull(PortionDraft("1 slice", "").portion())
    }

    @Test
    fun anEditOpensOnTheFoodsFigures() {
        val food = NutritionFood(
            id = "c1",
            source = NutritionFood.Source.Custom,
            name = "Granola",
            brand = "Acme",
            servingSizeG = 45.0,
            caloriesPer100g = 450.0,
            proteinPer100g = 10.5,
            isPublic = true,
            createdAt = "2026-11-01T00:00:00Z",
            updatedAt = "2026-11-01T00:00:00Z",
        )

        val sheet = customFoodSheet(food)

        assertEquals(food, sheet.editing)
        assertEquals(
            listOf("Granola", "Acme", "450", "10.5", "", "45"),
            listOf(sheet.name, sheet.brand, sheet.calories, sheet.protein, sheet.carb, sheet.servingSize),
        )
        assertTrue(sheet.isPublic)
    }
}
