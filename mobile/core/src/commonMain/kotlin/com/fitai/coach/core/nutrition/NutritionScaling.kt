package com.fitai.coach.core.nutrition

import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.core.js.jsRound
import kotlin.math.pow

/*
 * Port of shared/nutritionScaling.ts: the per-100g scaling rule the server
 * applies, so the food log's totals and the quantity-edit preview equal what
 * the server stores (audit M22). Pinned by the `nutritionScaling.*` golden
 * fixtures. Round once, at the end: totals are summed raw.
 */

private const val PER_100G = 100.0

/** `KCAL_PER_G_PROTEIN`: Atwater kcal per gram of protein. */
public const val KCAL_PER_G_PROTEIN: Double = 4.0

/** `KCAL_PER_G_CARB`: Atwater kcal per gram of carbohydrate. */
public const val KCAL_PER_G_CARB: Double = 4.0

/** `KCAL_PER_G_FAT`: Atwater kcal per gram of fat. */
public const val KCAL_PER_G_FAT: Double = 9.0

/** The Atwater factors keyed by macro, the shape of TS `KCAL_PER_G`. */
public data class MacroKcalFactors(val protein: Double, val carb: Double, val fat: Double)

/** `KCAL_PER_G`: the same factors keyed by macro, built from the constants above. */
public val KCAL_PER_G: MacroKcalFactors = MacroKcalFactors(
    protein = KCAL_PER_G_PROTEIN,
    carb = KCAL_PER_G_CARB,
    fat = KCAL_PER_G_FAT,
)

/** Macro grams per 100 g of food, plus an allowance for providers' 1-dp rounding. */
private const val MAX_MACRO_MASS_PER_100G = 101.0

/** `Per100gMacros`: a food's per-100g columns, the raw input to every total. A null value counts as 0 g. */
public data class Per100gMacros(
    val caloriesPer100g: Double? = null,
    val proteinPer100g: Double? = null,
    val carbPer100g: Double? = null,
    val fatPer100g: Double? = null,
    val fiberPer100g: Double? = null,
)

/** One logged row for [totalNutrition]: a food's per-100g values and the grams eaten (TS `{ per100g, quantityG }`). */
public data class FoodPortion(val per100g: Per100gMacros, val quantityG: Double)

private fun scaleValue(per100g: Double?, quantityG: Double): Double {
    if (per100g == null) return 0.0
    return (per100g * quantityG) / PER_100G
}

private fun round(value: Double, dp: Int): Double {
    val factor = 10.0.pow(dp)
    return jsRound(value * factor) / factor
}

/**
 * Port of the private `derivedCaloriesPer100g`: energy rebuilt from the macros
 * when the provider published none. Null when there is no energy-bearing macro,
 * or when the macros add up to more than 100 g of food can hold (fibre is left out).
 */
private fun derivedCaloriesPer100g(food: Per100gMacros): Double? {
    if (food.proteinPer100g == null && food.carbPer100g == null && food.fatPer100g == null) return null

    val protein = food.proteinPer100g ?: 0.0
    val carb = food.carbPer100g ?: 0.0
    val fat = food.fatPer100g ?: 0.0

    if (protein + carb + fat > MAX_MACRO_MASS_PER_100G) return null

    return protein * KCAL_PER_G_PROTEIN + carb * KCAL_PER_G_CARB + fat * KCAL_PER_G_FAT
}

/**
 * Port of `scaleNutrition`: a food's per-100g values scaled to [quantityG]
 * grams, unrounded. Null calories are derived from the macros
 * (`derivedCaloriesPer100g`). An explicit 0 kcal is kept.
 */
public fun scaleNutrition(food: Per100gMacros, quantityG: Double): NutritionMacroTotals {
    val caloriesPer100g = food.caloriesPer100g ?: derivedCaloriesPer100g(food)
    return NutritionMacroTotals(
        calories = scaleValue(caloriesPer100g, quantityG),
        protein = scaleValue(food.proteinPer100g, quantityG),
        carb = scaleValue(food.carbPer100g, quantityG),
        fat = scaleValue(food.fatPer100g, quantityG),
        fiber = scaleValue(food.fiberPer100g, quantityG),
    )
}

/** Port of `emptyTotals`: all five totals at 0. */
public fun emptyTotals(): NutritionMacroTotals =
    NutritionMacroTotals(calories = 0.0, protein = 0.0, carb = 0.0, fat = 0.0, fiber = 0.0)

/**
 * Port of `addInto`: [acc] plus [n], raw, field by field. The TS mutates its
 * accumulator; the generated totals are immutable, so this returns the sum:
 * `acc = addInto(acc, n)`. Each field is `acc + n`, the same IEEE addition as
 * `acc.x += n.x`. Round once at the end ([roundMacros]), never per addend.
 */
public fun addInto(acc: NutritionMacroTotals, n: NutritionMacroTotals): NutritionMacroTotals =
    NutritionMacroTotals(
        calories = acc.calories + n.calories,
        protein = acc.protein + n.protein,
        carb = acc.carb + n.carb,
        fat = acc.fat + n.fat,
        fiber = acc.fiber + n.fiber,
    )

/**
 * Port of `roundMacros`: whole calories and 1-dp macros, with JS `Math.round`
 * (ties towards +∞, so -0.05 g gives -0 and 1.005 g gives 1, as 1.005 × 10 is 10.0499…).
 */
public fun roundMacros(totals: NutritionMacroTotals): NutritionMacroTotals =
    NutritionMacroTotals(
        calories = jsRound(totals.calories),
        protein = round(totals.protein, 1),
        carb = round(totals.carb, 1),
        fat = round(totals.fat, 1),
        fiber = round(totals.fiber, 1),
    )

/**
 * Port of `totalNutrition`: every row scaled ([scaleNutrition]), summed raw in
 * order, then rounded once ([roundMacros]). Summing rounded per-entry totals
 * instead is what stopped meal cards adding up to the day.
 */
public fun totalNutrition(rows: List<FoodPortion>): NutritionMacroTotals {
    var totals = emptyTotals()
    for (row in rows) totals = addInto(totals, scaleNutrition(row.per100g, row.quantityG))
    return roundMacros(totals)
}
