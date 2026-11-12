package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.data.CustomFoodDraft
import com.fitai.coach.core.data.Portion

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

/** A typed amount: a finite number of zero or more, else null (blank included). */
fun parseAmount(text: String): Double? = text.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }

private fun Double?.typed(): String = when {
    this == null -> ""
    this % 1.0 == 0.0 -> toLong().toString()
    else -> toString()
}
