package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionParseMealResponse
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.data.MealEntryMethod
import com.fitai.coach.core.data.MealItem
import com.fitai.coach.core.js.jsRound

/**
 * One suggested food, editable before logging (ParsedMealReviewSheet's
 * ReviewRow): its amount in grams as typed, its meal, and its match, which
 * the athlete can swap. A row with no match can't be logged.
 */
data class ReviewRow(
    val key: String,
    val displayAmount: String,
    val grams: String,
    val meal: Meal,
    val confidence: Double,
    val food: NutritionFood?,
) {
    val quantityG: Double? get() = grams.trim().toDoubleOrNull()?.takeIf { it > 0 && it.isFinite() }
    val loggable: Boolean get() = food != null && quantityG != null
}

/** A parsed meal under review: the rows, the parser's warnings, and the row whose food is being swapped. */
data class MealReview(
    val method: MealEntryMethod,
    val rawInput: String,
    val warnings: List<String>,
    val rows: List<ReviewRow>,
    val swapping: Int? = null,
    val logging: Boolean = false,
) {
    val loggable: List<ReviewRow> get() = rows.filter { it.loggable }
    val unresolved: Int get() = rows.size - loggable.size
}

/**
 * The parse as rows to review: grams rounded, and an item with no meal put
 * in [fallback], the meal the athlete is most plausibly eating now.
 */
fun reviewRows(result: NutritionParseMealResponse, fallback: Meal): List<ReviewRow> = result.items.mapIndexed { i, item ->
    ReviewRow(
        key = "$i-${item.name}",
        displayAmount = item.displayAmount.ifBlank { item.name },
        grams = wholeGrams(item.quantityG),
        meal = item.mealType?.let { type -> Meal.entries.firstOrNull { it.wireValue == type.wireValue } } ?: fallback,
        confidence = item.confidence,
        food = item.food,
    )
}

private fun wholeGrams(grams: Double): String = jsRound(grams).toLong().toString()

/** The rows that can be logged, as the batch takes them. */
fun MealReview.items(): List<MealItem> = loggable.mapNotNull { row ->
    val food = row.food ?: return@mapNotNull null
    val grams = row.quantityG ?: return@mapNotNull null
    MealItem(food.id, grams, row.meal, row.confidence)
}

/** "Log 3 items". */
fun logItemsLabel(count: Int): String = "Log $count item${if (count == 1) "" else "s"}"

/** "2 items need a match and won't be logged."; null when every row has one. */
fun unresolvedNote(count: Int): String? =
    if (count == 0) null else "$count item${if (count == 1) "" else "s"} need${if (count == 1) "s" else ""} a match and won't be logged."

/** "Logged 3 items". */
fun loggedItemsToast(count: Long): String = "Logged $count item${if (count == 1L) "" else "s"}"

/** The describe box's limit (DescribeMealDialog). */
const val MAX_MEAL_DESCRIPTION = 2000
