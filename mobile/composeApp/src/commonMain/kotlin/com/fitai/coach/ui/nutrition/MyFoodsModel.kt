package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.core.api.generated.NutritionRecipe
import com.fitai.coach.core.data.CustomFoodDraft
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.data.Portion
import com.fitai.coach.core.data.RecipeDraft
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.nutrition.addInto
import com.fitai.coach.core.nutrition.emptyTotals
import com.fitai.coach.core.nutrition.roundMacros

/** A named portion as typed: a label and its grams. */
data class PortionDraft(val label: String = "", val grams: String = "") {
    /** The portion, once it has a label and a weight above zero. */
    fun portion(): Portion? = parseAmount(grams)?.takeIf { it > 0 && label.isNotBlank() }?.let { Portion(label.trim(), it) }
}

/**
 * The custom food sheet (CustomFoodDialog.tsx): a new food, or an edit of
 * [editing]. Nutrition is per 100 g; a blank figure is unknown.
 */
data class CustomFoodSheetState(
    val editing: NutritionFood? = null,
    val name: String = "",
    val brand: String = "",
    val calories: String = "",
    val protein: String = "",
    val carb: String = "",
    val fat: String = "",
    val fiber: String = "",
    val servingSize: String = "",
    /** Shared with everyone: an edit-only, explicit opt-in (a new food is private). */
    val isPublic: Boolean = false,
    /** Named portions, offered when creating. */
    val portions: List<PortionDraft> = emptyList(),
    val saving: Boolean = false,
) {
    val valid: Boolean get() = name.isNotBlank()

    /** What's saved. A figure that isn't a number of zero or more is left unknown, as the web's parseNum. */
    fun draft(): CustomFoodDraft = CustomFoodDraft(
        name = name.trim(),
        brand = brand.trim().ifEmpty { null },
        caloriesPer100g = parseAmount(calories),
        proteinPer100g = parseAmount(protein),
        carbPer100g = parseAmount(carb),
        fatPer100g = parseAmount(fat),
        fiberPer100g = parseAmount(fiber),
        servingSizeG = parseAmount(servingSize),
    )

    /** The named portions worth saving: a label and a weight above zero. */
    fun completePortions(): List<Portion> = portions.mapNotNull { it.portion() }
}

/** The sheet on an existing custom food. */
fun customFoodSheet(food: NutritionFood) = CustomFoodSheetState(
    editing = food,
    name = food.name,
    brand = food.brand.orEmpty(),
    calories = food.caloriesPer100g.typed(),
    protein = food.proteinPer100g.typed(),
    carb = food.carbPer100g.typed(),
    fat = food.fatPer100g.typed(),
    fiber = food.fiberPer100g.typed(),
    servingSize = food.servingSizeG.typed(),
    isPublic = food.isPublic,
)

/** A recipe ingredient as typed: its grams, and its nutrition per 100 g for the preview. */
data class IngredientDraft(val foodId: String, val name: String, val grams: String, val per100g: NutritionMacroTotals) {
    /** The grams, once they're a number above zero. */
    val quantityG: Double? get() = parseAmount(grams)?.takeIf { it > 0 }
}

/**
 * The recipe builder (RecipeBuilderDialog.tsx): a new recipe, or an edit of
 * [editingId], which [loading] fetches first.
 */
data class RecipeSheetState(
    val editingId: String? = null,
    val name: String = "",
    val servings: String = "1",
    val ingredients: List<IngredientDraft> = emptyList(),
    val loading: Boolean = false,
    val saving: Boolean = false,
) {
    /** How many servings it makes, once that's a number above zero. */
    val servingCount: Double? get() = parseAmount(servings)?.takeIf { it > 0 }

    val valid: Boolean
        get() = name.isNotBlank() && ingredients.isNotEmpty() && servingCount != null && ingredients.all { it.quantityG != null }

    /** One serving's nutrition, as the web previews it: whole calories, macros to 0.1 g. */
    fun perServing(): NutritionMacroTotals {
        val total = ingredients.fold(emptyTotals()) { acc, ingredient ->
            addInto(
                acc,
                ingredient.per100g.times(
                    (ingredient.quantityG ?: 0.0) / PER_100G,
                ),
            )
        }
        return roundMacros(total.times(1 / (servingCount ?: 1.0)))
    }

    fun draft(): RecipeDraft = RecipeDraft(
        name = name.trim(),
        servings = servingCount ?: 1.0,
        ingredients = ingredients.map { RecipeDraft.Ingredient(it.foodId, it.quantityG ?: 0.0) },
    )
}

/** The builder on a saved recipe; each ingredient's per-100 g is worked back from its nutrition. */
fun recipeSheet(recipe: NutritionRecipe) = RecipeSheetState(
    editingId = recipe.id,
    name = recipe.name,
    servings = recipe.servings.typed(),
    ingredients = recipe.ingredients.map { IngredientDraft(it.foodId, it.name, it.quantityG.typed(), per100g(it.nutrition, it.quantityG)) },
)

/**
 * "My usual breakfast" in one go: a new recipe named after [meal], made of
 * its entries, the same food's entries merged into one ingredient
 * (Nutrition.tsx onSaveAsRecipe).
 */
fun recipeFromMeal(meal: Meal, entries: List<NutritionLogEntryWithNutrition>) = RecipeSheetState(
    name = meal.label,
    ingredients = entries.groupBy { it.foodId }.map { (foodId, same) ->
        val grams = same.sumOf { it.quantityG }
        val nutrition = same.fold(emptyTotals()) { acc, entry -> addInto(acc, entry.nutrition) }
        IngredientDraft(foodId, same.first().name, grams.typed(), per100g(nutrition, grams))
    },
)

/** A searched food as a new ingredient: one serving of it, or 100 g. */
fun ingredientFor(food: NutritionFood) = IngredientDraft(
    foodId = food.id,
    name = food.name,
    grams = jsRound(food.servingSizeG ?: PER_100G).toLong().toString(),
    per100g = NutritionMacroTotals(
        calories = food.caloriesPer100g ?: 0.0,
        protein = food.proteinPer100g ?: 0.0,
        carb = food.carbPer100g ?: 0.0,
        fat = food.fatPer100g ?: 0.0,
        fiber = food.fiberPer100g ?: 0.0,
    ),
)

private const val PER_100G = 100.0

private fun per100g(nutrition: NutritionMacroTotals, quantityG: Double): NutritionMacroTotals =
    nutrition.times(if (quantityG > 0) PER_100G / quantityG else 0.0)

private fun NutritionMacroTotals.times(factor: Double) =
    NutritionMacroTotals(calories * factor, protein * factor, carb * factor, fat * factor, fiber * factor)

/** A typed amount: a finite number of zero or more, else null (blank included). */
fun parseAmount(text: String): Double? = text.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }

private fun Double?.typed(): String = when {
    this == null -> ""
    this % 1.0 == 0.0 -> toLong().toString()
    else -> toString()
}
