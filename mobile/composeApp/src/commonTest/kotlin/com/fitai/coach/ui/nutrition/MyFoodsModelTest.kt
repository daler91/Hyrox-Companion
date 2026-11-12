package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionLabelMacroSet
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.core.api.generated.NutritionMealType
import com.fitai.coach.core.api.generated.NutritionRecipe
import com.fitai.coach.core.api.generated.PostNutritionParseLabelResponse
import com.fitai.coach.core.api.generated.PostNutritionParseLabelResponse.Suggestion
import com.fitai.coach.core.data.CustomFoodDraft
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.data.Portion
import com.fitai.coach.core.data.RecipeDraft
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

    private fun macros(calories: Double, protein: Double, carb: Double, fat: Double, fiber: Double) =
        NutritionMacroTotals(calories, protein, carb, fat, fiber)

    @Test
    fun aRecipesServingIsItsIngredientsDividedByItsServings() {
        val sheet = RecipeSheetState(
            name = "Overnight oats",
            servings = "2",
            ingredients = listOf(
                IngredientDraft("f1", "Oats", "80", macros(380.0, 13.0, 66.0, 7.0, 10.0)),
                IngredientDraft("f2", "Milk", "250", macros(64.0, 3.2, 4.8, 3.6, 0.0)),
            ),
        )

        // (304 + 160) / 2 kcal; (10.4 + 8) / 2 g protein, to 0.1 g.
        assertEquals(macros(232.0, 9.2, 32.4, 7.3, 4.0), sheet.perServing())
        assertTrue(sheet.valid)
        assertEquals(
            RecipeDraft("Overnight oats", 2.0, listOf(RecipeDraft.Ingredient("f1", 80.0), RecipeDraft.Ingredient("f2", 250.0))),
            sheet.draft(),
        )
    }

    @Test
    fun aRecipeNeedsANameServingsAndIngredientsWithWeights() {
        val oats = IngredientDraft("f1", "Oats", "80", macros(380.0, 13.0, 66.0, 7.0, 10.0))
        assertFalse(RecipeSheetState(name = "Oats", ingredients = emptyList()).valid)
        assertFalse(RecipeSheetState(name = " ", ingredients = listOf(oats)).valid)
        assertFalse(RecipeSheetState(name = "Oats", servings = "0", ingredients = listOf(oats)).valid)
        assertFalse(RecipeSheetState(name = "Oats", ingredients = listOf(oats.copy(grams = ""))).valid)
        assertTrue(RecipeSheetState(name = "Oats", ingredients = listOf(oats)).valid)
    }

    @Test
    fun aMealBecomesARecipeWithTheSameFoodMerged() {
        fun entry(id: String, foodId: String, name: String, grams: Double, calories: Double) = NutritionLogEntryWithNutrition(
            id = id,
            foodId = foodId,
            name = name,
            loggedAt = "2026-11-08T08:00:00Z",
            logDate = "2026-11-08",
            quantityG = grams,
            mealType = NutritionMealType.Breakfast,
            entryMethod = NutritionLogEntryWithNutrition.EntryMethod.entries.first(),
            nutrition = macros(calories, 0.0, 0.0, 0.0, 0.0),
            per100g = NutritionLogEntryWithNutrition.Per100g(),
        )

        val sheet = recipeFromMeal(
            Meal.Breakfast,
            listOf(entry("e1", "f1", "Oats", 40.0, 152.0), entry("e2", "f2", "Milk", 200.0, 128.0), entry("e3", "f1", "Oats", 40.0, 152.0)),
        )

        assertEquals("Breakfast", sheet.name)
        assertEquals(listOf("Oats" to "80", "Milk" to "200"), sheet.ingredients.map { it.name to it.grams })
        // Per 100 g is worked back from what was logged: 304 kcal in 80 g.
        assertEquals(380.0, sheet.ingredients.first().per100g.calories)
        assertEquals(null, sheet.editingId)
    }

    @Test
    fun aSavedRecipeOpensOnItsIngredients() {
        val recipe = NutritionRecipe(
            id = "r1",
            name = "Overnight oats",
            servings = 2.0,
            foodId = "rf1",
            totalGrams = 330.0,
            perServing = macros(232.0, 9.5, 32.4, 7.3, 4.0),
            ingredients = listOf(
                NutritionRecipe.IngredientsItem(
                    "i1",
                    "f1",
                    "Oats",
                    quantityG = 80.0,
                    position = 0,
                    nutrition = macros(304.0, 10.4, 52.8, 5.6, 8.0),
                ),
            ),
        )

        val sheet = recipeSheet(recipe)

        assertEquals("r1", sheet.editingId)
        assertEquals("2", sheet.servings)
        assertEquals(listOf("80"), sheet.ingredients.map { it.grams })
        assertEquals(380.0, sheet.ingredients.single().per100g.calories, 1e-9)
    }

    @Test
    fun aSearchedFoodIsAddedAtOneServingOrAHundredGrams() {
        val food = NutritionFood(
            id = "f1",
            source = NutritionFood.Source.Usda,
            name = "Oats",
            servingSizeG = 40.4,
            caloriesPer100g = 380.0,
            isPublic = true,
            createdAt = "2026-11-01T00:00:00Z",
            updatedAt = "2026-11-01T00:00:00Z",
        )

        assertEquals("40", ingredientFor(food).grams)
        assertEquals("100", ingredientFor(food.copy(servingSizeG = null)).grams)
        assertEquals(macros(380.0, 0.0, 0.0, 0.0, 0.0), ingredientFor(food).per100g)
    }

    private fun label(perServing: NutritionLabelMacroSet?, servingSizeText: String?) = PostNutritionParseLabelResponse.Label(
        productName = "Protein bar",
        perServing = perServing,
        servingSizeText = servingSizeText,
        basis = PostNutritionParseLabelResponse.Label.Basis.Per100g,
        confidence = 90.0,
    )

    @Test
    fun aScannedLabelFillsInTheFoodAndThePortionsThePackageImplies() {
        val result = PostNutritionParseLabelResponse(
            label = label(perServing = null, servingSizeText = "1 bar (40 g)"),
            suggestion = Suggestion(
                name = "Protein bar",
                brand = "Grenade",
                caloriesPer100g = 450.0,
                proteinPer100g = 20.5,
                carbPer100g = 50.0,
                fatPer100g = 18.0,
                servingSizeG = 40.0,
                servings = listOf(Suggestion.ServingsItem("1 bar", 40.0), Suggestion.ServingsItem("Whole package", 480.0)),
            ),
            warnings = listOf("Energy converted from kJ."),
        )

        val sheet = customFoodFromLabel(result)

        assertEquals("Protein bar", sheet.name)
        assertEquals("Grenade", sheet.brand)
        assertEquals("450", sheet.calories)
        assertEquals("20.5", sheet.protein)
        // Not printed: left blank, unknown.
        assertEquals("", sheet.fiber)
        assertEquals("40", sheet.servingSize)
        assertEquals(listOf(PortionDraft("1 bar", "40"), PortionDraft("Whole package", "480")), sheet.portions)
        assertEquals(listOf("Energy converted from kJ."), sheet.label?.warnings)
        // Per 100 g came through, so there's nothing printed per serving to convert.
        assertNull(sheet.label?.perServing)
        assertNull(sheet.editing)
    }

    @Test
    fun aPerServingLabelWithNoWeightShowsThePrintedValuesToConvert() {
        val result = PostNutritionParseLabelResponse(
            label = label(NutritionLabelMacroSet(calories = 180.0, protein = 8.0, carb = 20.5), servingSizeText = "1 bar"),
            suggestion = Suggestion(name = "Protein bar", servings = emptyList()),
            warnings = emptyList(),
        )

        val printed = customFoodFromLabel(result).label?.perServing

        assertEquals(PrintedServing("Printed per serving (1 bar)", "180 kcal · 8 g protein · 20.5 g carbs"), printed)
    }
}
