package com.fitai.coach.core.nutrition

import com.fitai.coach.core.js.jsRound

/*
 * Port of `mergeMealOverride` from shared/mealFuelling.ts, and the private
 * helpers it needs. The rest of that module (computeMealFuelTargets) stays on
 * the server, which returns the per-meal split in the nutrition day summary;
 * the meal-target editor merges the athlete's edits onto that split to preview
 * what a save will read. Pinned by the `mealFuelling.mergeMealOverride` fixtures.
 */

/** `MealFuelValues`: a meal's four target figures (kcal and grams). */
public data class MealFuelValues(
    val calories: Double,
    val carbG: Double,
    val proteinG: Double,
    val fatG: Double,
)

/** `MealFuelOverride`: a per-meal override; a null field keeps the split's figure. */
public data class MealFuelOverride(
    val calories: Double? = null,
    val carbG: Double? = null,
    val proteinG: Double? = null,
    val fatG: Double? = null,
)

/**
 * `MergedMealOverride`: a meal's figures under an override. When
 * [caloriesFromMacros] is true the pinned macros set the calories and a pinned
 * calorie figure was ignored, so the editor shows the calories locked and saves
 * no calorie pin beside the macros.
 */
public data class MergedMealOverride(
    val calories: Double,
    val carbG: Double,
    val proteinG: Double,
    val fatG: Double,
    val caloriesFromMacros: Boolean,
)

/** TS `MealMacros`. */
private data class MealMacros(val carbG: Double, val proteinG: Double, val fatG: Double)

private val MealFuelValues.macros: MealMacros get() = MealMacros(carbG = carbG, proteinG = proteinG, fatG = fatG)

/** Port of the private `round1`: to 0.1 g with JS `Math.round`. */
private fun round1(n: Double): Double = jsRound(n * 10.0) / 10.0

/** Port of the private `mealMacroKcal`: the whole-kcal energy in a meal's macros (protein, then carb, then fat). */
private fun mealMacroKcal(m: MealMacros): Double =
    jsRound(m.proteinG * KCAL_PER_G.protein + m.carbG * KCAL_PER_G.carb + m.fatG * KCAL_PER_G.fat)

/**
 * Port of the private `keepsUnsetMacroShare`: the split gave the meal calories
 * its macros don't account for, and a macro the split has at 0 g is still at 0 g.
 */
private fun keepsUnsetMacroShare(split: MealFuelValues, final: MealMacros): Boolean {
    if (split.calories <= mealMacroKcal(split.macros)) return false
    return (split.carbG == 0.0 && final.carbG == 0.0) ||
        (split.proteinG == 0.0 && final.proteinG == 0.0) ||
        (split.fatG == 0.0 && final.fatG == 0.0)
}

/**
 * Port of the private `overriddenMealCalories`: the final macros' energy, plus
 * what of the meal's unset-macro share they leave unfilled while it keeps one.
 */
private fun overriddenMealCalories(split: MealFuelValues, final: MealMacros): Double {
    val macroKcal = mealMacroKcal(final)
    if (!keepsUnsetMacroShare(split, final)) return macroKcal
    val unaccounted = split.calories - mealMacroKcal(split.macros)
    val filled = mealMacroKcal(
        MealMacros(
            carbG = if (split.carbG == 0.0) final.carbG else 0.0,
            proteinG = if (split.proteinG == 0.0) final.proteinG else 0.0,
            fatG = if (split.fatG == 0.0) final.fatG else 0.0,
        ),
    )
    return macroKcal + maxOf(0.0, unaccounted - filled)
}

/**
 * Port of `mergeMealOverride`: a meal's figures under [ov], from the [split] it
 * replaces. Macros are the override's (or the split's) rounded to 0.1 g.
 * Calorie precedence:
 *  1. Every macro pinned, one differing from the split, and the meal no longer
 *     keeping its unset-macro share: the macros' energy; a calorie pin is ignored.
 *  2. Otherwise pinned calories win, rounded to whole kcal.
 *  3. Otherwise a changed macro rebuilds them; else the split's calories stand.
 */
public fun mergeMealOverride(split: MealFuelValues, ov: MealFuelOverride): MergedMealOverride {
    val final = MealMacros(
        carbG = round1(ov.carbG ?: split.carbG),
        proteinG = round1(ov.proteinG ?: split.proteinG),
        fatG = round1(ov.fatG ?: split.fatG),
    )
    // Double (non-null) comparisons are IEEE 754, as JS `!==` on numbers: -0 equals 0, NaN equals nothing.
    val macroEdited = final.carbG != split.carbG || final.proteinG != split.proteinG || final.fatG != split.fatG
    val fullMacroSet = ov.carbG != null && ov.proteinG != null && ov.fatG != null
    val caloriesFromMacros = macroEdited && fullMacroSet && !keepsUnsetMacroShare(split, final)
    val pinnedCalories = ov.calories
    val calories = when {
        caloriesFromMacros -> mealMacroKcal(final)
        pinnedCalories != null -> jsRound(pinnedCalories)
        macroEdited -> overriddenMealCalories(split, final)
        else -> split.calories
    }
    return MergedMealOverride(
        calories = calories,
        carbG = final.carbG,
        proteinG = final.proteinG,
        fatG = final.fatG,
        caloriesFromMacros = caloriesFromMacros,
    )
}
