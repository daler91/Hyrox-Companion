package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionFoodWithPortionMemory
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.api.generated.NutritionMealType
import com.fitai.coach.core.data.Meal
import com.fitai.coach.ui.format.formatNumber
import kotlin.math.roundToLong

/** The portion and meal a food was last logged in (useNutrition.ts PortionHint). */
data class PortionHint(val quantityG: Double, val meal: Meal)

/** A known food, amount and meal to log in one tap (useQuickLog.tsx QuickLogItem). */
data class QuickLogItem(val foodId: String, val name: String, val quantityG: Double, val meal: Meal)

/** The recent and favourite foods; a list is null until it has loaded once. */
data class QuickAddState(
    val recent: List<NutritionFoodWithPortionMemory>? = null,
    val favorites: List<NutritionFoodWithPortionMemory>? = null,
) {
    /**
     * Never logged anything: no recent foods and no favourites. There is
     * nothing to repeat, so the repeat and copy shortcuts stay hidden
     * (Nutrition.tsx isFirstRun). Unknown until both lists have loaded.
     */
    val firstRun: Boolean get() = recent?.isEmpty() == true && favorites?.isEmpty() == true

    /** There are foods to show as chips. */
    val hasFoods: Boolean get() = !recent.isNullOrEmpty() || !favorites.isNullOrEmpty()

    /**
     * The remembered portion of each food, by id (usePortionMemory): from the
     * recent foods and the favourites, so a food reached from search gets its
     * portion too. A favourite wins a tie, being the athlete's own pick.
     */
    val portions: Map<String, PortionHint>
        get() = (recent.orEmpty() + favorites.orEmpty()).mapNotNull { food -> food.portionHint()?.let { food.id to it } }.toMap()
}

/** The portion this food was last logged in, when it has been logged. */
fun NutritionFoodWithPortionMemory.portionHint(): PortionHint? {
    val grams = lastQuantityG
    val meal = lastMealType?.toMeal()
    return if (grams != null && meal != null) PortionHint(grams, meal) else null
}

/** A favourite logs in one tap when its portion is known; otherwise it opens the log sheet (QuickAddBar.tsx). */
fun NutritionFoodWithPortionMemory.quickLogItem(): QuickLogItem? = portionHint()?.let { QuickLogItem(id, name, it.quantityG, it.meal) }

/** The same entry again: food, amount and meal ("Log again today"). */
fun NutritionLogEntryWithNutrition.quickLogItem(): QuickLogItem =
    QuickLogItem(foodId, name, quantityG, mealType.toMeal() ?: Meal.Snack)

/** What a one-tap log says, with its undo: "Logged Oats · 80 g · Breakfast" (useQuickLog.tsx). */
fun quickLoggedMessage(
    item: QuickLogItem,
): String = "Logged ${item.name} · ${formatNumber(item.quantityG.roundToLong().toDouble())} g · ${item.meal.label}"

/** What a repeat says: "Repeated 3 items". */
fun repeatedMessage(created: Long): String = "Repeated $created item${if (created == 1L) "" else "s"}"

/** The food the log sheet opens on. */
fun NutritionFoodWithPortionMemory.toFood(): NutritionFood = NutritionFood(
    id = id,
    source = NutritionFood.Source.entries.firstOrNull { it.wireValue == source.wireValue } ?: NutritionFood.Source.Unknown,
    sourceId = sourceId,
    name = name,
    brand = brand,
    servingSizeG = servingSizeG,
    caloriesPer100g = caloriesPer100g,
    proteinPer100g = proteinPer100g,
    carbPer100g = carbPer100g,
    fatPer100g = fatPer100g,
    fiberPer100g = fiberPer100g,
    micros = micros,
    lastFetchedAt = lastFetchedAt,
    createdByUserId = createdByUserId,
    isPublic = isPublic,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

/** A chip shows the first 24 characters of a long name (QuickAddBar.tsx MAX_LABEL). */
fun chipLabel(name: String): String = if (name.length > MAX_CHIP_LABEL) name.take(MAX_CHIP_LABEL) + "…" else name

private const val MAX_CHIP_LABEL = 24

private fun NutritionMealType.toMeal(): Meal? = Meal.entries.firstOrNull { it.wireValue == wireValue }
