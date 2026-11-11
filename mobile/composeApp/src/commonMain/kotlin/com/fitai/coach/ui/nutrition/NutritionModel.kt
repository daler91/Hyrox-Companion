package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionFoodServing
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.api.generated.NutritionMealFuelTarget
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.nutrition.Per100gMacros
import kotlin.math.abs

/** A portion the log sheet offers: grams, a named serving, or the food's own serving size. */
data class PortionUnit(val label: String, val grams: Double)

private const val SERVING_MATCH_TOLERANCE_G = 0.5
private const val DEFAULT_GRAMS = 100.0

/**
 * The units the log sheet offers (LogFoodDialog.tsx): grams, the named
 * servings by size, then "1 serving (N g)" from the food's serving size
 * unless a named serving already is that size.
 */
fun portionUnits(food: NutritionFood, servings: List<NutritionFoodServing>): List<PortionUnit> = buildList {
    add(PortionUnit("g", 1.0))
    servings.sortedBy { it.grams }.forEach { add(PortionUnit("${it.label} (${trimGrams(it.grams)} g)", it.grams)) }
    food.servingSizeG?.takeIf { size -> size > 0 && servings.none { abs(it.grams - size) <= SERVING_MATCH_TOLERANCE_G } }?.let {
        add(PortionUnit("1 serving (${trimGrams(it)} g)", it))
    }
}

/** The amount a new entry starts at: one serving when there is one, else 100 g. */
fun defaultPortion(units: List<PortionUnit>): Pair<PortionUnit, Double> =
    units.firstOrNull { it.grams != 1.0 }?.let { it to 1.0 } ?: (units.first() to DEFAULT_GRAMS)

/** The meal a new entry goes to by the clock (utils.ts): breakfast before 11, lunch before 15, dinner before 21, then snack. */
fun mealForHour(hour: Int): Meal = when {
    hour < BREAKFAST_UNTIL -> Meal.Breakfast
    hour < LUNCH_UNTIL -> Meal.Lunch
    hour < DINNER_UNTIL -> Meal.Dinner
    else -> Meal.Snack
}

private const val BREAKFAST_UNTIL = 11
private const val LUNCH_UNTIL = 15
private const val DINNER_UNTIL = 21

/** A macro against its target: the bar clamps at 100% and turns amber over it. */
data class MacroProgress(val value: Double, val target: Double?) {
    private val ratio: Double? get() = target?.takeIf { it > 0 }?.let { value / it }
    val fraction: Float? get() = ratio?.coerceIn(0.0, 1.0)?.toFloat()
    val over: Boolean get() = (ratio ?: 0.0) > 1.0
}

fun GetNutritionSummaryResponse.entries(meal: Meal): List<NutritionLogEntryWithNutrition> = when (meal) {
    Meal.Breakfast -> meals.breakfast
    Meal.Lunch -> meals.lunch
    Meal.Dinner -> meals.dinner
    Meal.Snack -> meals.snack
    Meal.SnackPm -> meals.snackPm
    Meal.PreWorkout -> meals.preWorkout
    Meal.PostWorkout -> meals.postWorkout
}

fun GetNutritionSummaryResponse.target(meal: Meal): NutritionMealFuelTarget? = mealTargets?.let {
    when (meal) {
        Meal.Breakfast -> it.breakfast
        Meal.Lunch -> it.lunch
        Meal.Dinner -> it.dinner
        Meal.Snack -> it.snack
        Meal.SnackPm -> it.snackPm
        Meal.PreWorkout -> it.preWorkout
        Meal.PostWorkout -> it.postWorkout
    }
}

/** Nothing logged in any meal. */
fun GetNutritionSummaryResponse.isEmptyDay(): Boolean = Meal.entries.all { entries(it).isEmpty() }

/** The meals to show: those with entries or a target (MealSection.tsx hides the rest). */
fun GetNutritionSummaryResponse.visibleMeals(): List<Meal> = Meal.entries.filter { entries(it).isNotEmpty() || target(it) != null }

fun NutritionFood.per100g() = Per100gMacros(caloriesPer100g, proteinPer100g, carbPer100g, fatPer100g, fiberPer100g)

fun NutritionLogEntryWithNutrition.Per100g.toMacros() = Per100gMacros(
    caloriesPer100g,
    proteinPer100g,
    carbPer100g,
    fatPer100g,
    fiberPer100g,
)

private fun trimGrams(grams: Double): String = if (grams % 1.0 == 0.0) grams.toLong().toString() else grams.toString()
