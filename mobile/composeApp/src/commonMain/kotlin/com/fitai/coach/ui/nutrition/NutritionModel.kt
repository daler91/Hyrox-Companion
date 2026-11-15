package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionFoodServing
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.api.generated.NutritionMealFuelTarget
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.nutrition.Per100gMacros
import com.fitai.coach.ui.format.formatNumber
import kotlin.math.abs
import kotlin.math.round

/**
 * A portion the log sheet offers: grams, a named serving, or the food's own
 * serving size. [serving] is the named serving it came from.
 */
data class PortionUnit(val label: String, val grams: Double, val serving: NutritionFoodServing? = null) {
    /** The athlete's own portion, which they can remove (shared ones can't be). */
    val own: Boolean get() = serving?.createdByUserId != null
}

private const val SERVING_MATCH_TOLERANCE_G = 0.5
private const val DEFAULT_GRAMS = 100.0

/**
 * The units the log sheet offers (LogFoodDialog.tsx): grams, the named
 * servings by size, then "1 serving (N g)" from the food's serving size
 * unless a named serving already is that size.
 */
fun portionUnits(food: NutritionFood, servings: List<NutritionFoodServing>): List<PortionUnit> = buildList {
    add(PortionUnit("g", 1.0))
    servings.sortedBy { it.grams }.forEach { add(PortionUnit("${it.label} (${trimGrams(it.grams)} g)", it.grams, it)) }
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

/**
 * One macro of the day for its tile: the number, its name with the unit, and
 * the number against its target ("1226 / 2600") when there is one.
 */
data class DayMacro(val label: String, val value: Double, val target: Double?) {
    /** A whole number: a tile is for a glance, and the decimals are in the entries. */
    val shown: String get() = formatNumber(round(value))
    val against: String? get() = target?.takeIf { it > 0 }?.let { "$shown / ${formatNumber(round(it))}" }

    /** "Calories 1226 of 2600", as a screen reader says the tile. */
    val spoken: String get() = "$label $shown" + target?.takeIf { it > 0 }?.let { " of ${formatNumber(round(it))}" }.orEmpty()
}

/** The day's five tiles in the web's order (MacroProgressGrid); fibre has no target to chase. */
fun dayMacros(summary: GetNutritionSummaryResponse): List<DayMacro> {
    val target = summary.effectiveTarget
    return listOf(
        DayMacro("Calories", summary.totals.calories, target?.calories),
        DayMacro("Protein (g)", summary.totals.protein, target?.proteinG),
        DayMacro("Carbs (g)", summary.totals.carb, target?.carbG),
        DayMacro("Fat (g)", summary.totals.fat, target?.fatG),
        DayMacro("Fiber (g)", summary.totals.fiber, null),
    )
}

/** One macro of a meal against the meal's target: "63/38g". */
data class MealMacro(val label: String, val logged: Double, val target: Double) {
    val against: String get() = "${formatNumber(round(logged))}/${formatNumber(round(target))}g"
    val spoken: String get() = "$label ${formatNumber(round(logged))} of ${formatNumber(round(target))} grams"
}

/** Protein, carbs and fat the meal's entries add up to, against its target (MealMacroBars). */
fun mealMacros(entries: List<NutritionLogEntryWithNutrition>, target: NutritionMealFuelTarget): List<MealMacro> = listOf(
    MealMacro("Protein", entries.sumOf { it.nutrition.protein }, target.proteinG),
    MealMacro("Carbs", entries.sumOf { it.nutrition.carb }, target.carbG),
    MealMacro("Fat", entries.sumOf { it.nutrition.fat }, target.fatG),
)

/** "80 g · 303 kcal · P 10 C 54 F 5": what was eaten, in whole numbers. */
fun entrySummary(entry: NutritionLogEntryWithNutrition): String {
    val n = entry.nutrition
    return "${formatNumber(entry.quantityG)} g · ${formatNumber(round(n.calories))} kcal · " +
        "P ${formatNumber(round(n.protein))} C ${formatNumber(round(n.carb))} F ${formatNumber(round(n.fat))}"
}
