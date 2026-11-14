package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.GetNutritionMicrosResponse
import com.fitai.coach.core.api.generated.NutritionEffectiveTarget
import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.nutrition.KCAL_PER_G_CARB
import com.fitai.coach.core.nutrition.KCAL_PER_G_FAT
import com.fitai.coach.core.nutrition.KCAL_PER_G_PROTEIN
import com.fitai.coach.core.nutrition.MICRO_DISPLAY_DEFS
import com.fitai.coach.core.nutrition.MicroUnit
import com.fitai.coach.core.nutrition.emptyTotals
import com.fitai.coach.core.nutrition.roundMacros
import com.fitai.coach.core.nutrition.scaleNutrition

private const val PER_100G = 100.0
private const val PERCENT = 100.0
private const val TENTHS = 10.0

/** FDA Daily Value for fibre: the fibre bar's reference (MacroRows.tsx), not a goal. */
const val FIBER_DV_G = 28.0

private fun round1(value: Double): Double = jsRound(value * TENTHS) / TENTHS

private fun percentOf(value: Double, of: Double): Int = jsRound(value / of * PERCENT).toInt()

/** One macro's energy in a serving: grams, kcal, and whole-percent share of the macro energy. */
data class MacroEnergyShare(val g: Double, val kcal: Double, val pct: Int)

/**
 * A serving's energy by macro (utils.ts MacroEnergyShares). [totalKcal] is
 * rebuilt from the macros, so the shares add up to 100% even where it differs
 * from the food's label calories.
 */
data class MacroEnergyShares(val protein: MacroEnergyShare, val carb: MacroEnergyShare, val fat: MacroEnergyShare, val totalKcal: Double)

/** Port of `macroEnergyShares`: each macro's kcal and share; all zero for a serving with no macro energy. */
fun macroEnergyShares(macros: NutritionMacroTotals): MacroEnergyShares {
    val proteinKcal = maxOf(0.0, macros.protein) * KCAL_PER_G_PROTEIN
    val carbKcal = maxOf(0.0, macros.carb) * KCAL_PER_G_CARB
    val fatKcal = maxOf(0.0, macros.fat) * KCAL_PER_G_FAT
    val total = proteinKcal + carbKcal + fatKcal
    fun pct(kcal: Double) = if (total > 0) percentOf(kcal, total) else 0
    return MacroEnergyShares(
        protein = MacroEnergyShare(macros.protein, proteinKcal, pct(proteinKcal)),
        carb = MacroEnergyShare(macros.carb, carbKcal, pct(carbKcal)),
        fat = MacroEnergyShare(macros.fat, fatKcal, pct(fatKcal)),
        totalKcal = total,
    )
}

/**
 * Port of `previewMicrosScaled`: the food's per-100 g micros scaled to
 * [quantityG]. Only the micros the food carries come back (absent isn't
 * zero); none for no grams.
 */
fun previewMicrosScaled(micros: Map<String, Double>?, quantityG: Double): Map<String, Double> {
    if (micros == null || quantityG <= 0 || quantityG.isNaN()) return emptyMap()
    return micros.filterValues { it.isFinite() }.mapValues { (_, per100g) -> per100g * quantityG / PER_100G }
}

/**
 * Port of `buildPreviewMicroRows`: the scaled micros as rows in display
 * order, the shape GET /api/v1/nutrition/micros lists, so the rows look the
 * same as the day's. Micros with no data are left out.
 */
fun buildPreviewMicroRows(scaled: Map<String, Double>): List<GetNutritionMicrosResponse.MicrosItem> =
    MICRO_DISPLAY_DEFS.mapNotNull { def ->
        val amount = scaled[def.key] ?: return@mapNotNull null
        GetNutritionMicrosResponse.MicrosItem(
            key = def.key,
            label = def.label,
            unit = if (def.unit ==
                MicroUnit.Mg
            ) {
                GetNutritionMicrosResponse.MicrosItem.Unit.Mg
            } else {
                GetNutritionMicrosResponse.MicrosItem.Unit.Mcg
            },
            amount = round1(amount),
            rdi = def.rdi,
            pctRdi = jsRound(amount / def.rdi * PERCENT).toLong(),
        )
    }

/** Which micros are minerals; the rest are vitamins (MicronutrientPreviewPanel.tsx). */
val MINERAL_KEYS: Set<String> = setOf("sodium", "potassium", "calcium", "iron", "magnesium", "zinc")

/** A day's macro goals (utils.ts TargetLike); a missing or zero goal is skipped. */
data class MacroGoals(val calories: Double?, val proteinG: Double?, val carbG: Double?, val fatG: Double?) {
    companion object {
        fun of(target: NutritionEffectiveTarget?): MacroGoals? = target?.let { MacroGoals(it.calories, it.proteinG, it.carbG, it.fatG) }
    }
}

/** Which macro a goal row is about. */
enum class GoalMacro(val label: String) {
    Calories("Calories"),
    Protein("Protein"),
    Carbs("Carbs"),
    Fat("Fat"),
}

/** One macro's progress (utils.ts TargetProgressRow): [pct] is uncapped. */
data class TargetProgressRow(val macro: GoalMacro, val value: Double, val target: Double, val pct: Int, val remaining: Double)

/** Port of `computeTargetProgress`: [totals] against [goals], one row per macro with a goal set. */
fun computeTargetProgress(totals: NutritionMacroTotals, goals: MacroGoals?): List<TargetProgressRow> {
    if (goals == null) return emptyList()
    val fields = listOf(
        Triple(GoalMacro.Calories, goals.calories, totals.calories),
        Triple(GoalMacro.Protein, goals.proteinG, totals.protein),
        Triple(GoalMacro.Carbs, goals.carbG, totals.carb),
        Triple(GoalMacro.Fat, goals.fatG, totals.fat),
    )
    return fields.mapNotNull { (macro, goal, value) ->
        goal?.takeIf { it > 0 }?.let { TargetProgressRow(macro, value, it, percentOf(value, it), round1(it - value)) }
    }
}

/**
 * One macro's "effect on today's goals" (utils.ts GoalContributionRow):
 * today's total, what the serving adds, and where that lands against the goal.
 */
data class GoalContributionRow(
    val macro: GoalMacro,
    val current: Double,
    val added: Double,
    val projected: Double,
    val target: Double,
    val currentPct: Int,
    val projectedPct: Int,
)

/**
 * Port of `projectGoalContribution`: how logging [serving] moves [today]
 * towards [goals]. An edit passes its saved serving as [replacing], which
 * today's totals already count, so an unchanged edit adds nothing.
 */
fun projectGoalContribution(
    today: NutritionMacroTotals,
    serving: NutritionMacroTotals,
    goals: MacroGoals?,
    replacing: NutritionMacroTotals? = null,
): List<GoalContributionRow> {
    if (goals == null) return emptyList()
    val old = replacing ?: emptyTotals()
    val projectedTotals = NutritionMacroTotals(
        calories = today.calories + (serving.calories - old.calories),
        protein = today.protein + (serving.protein - old.protein),
        carb = today.carb + (serving.carb - old.carb),
        fat = today.fat + (serving.fat - old.fat),
        fiber = today.fiber + (serving.fiber - old.fiber),
    )
    val current = computeTargetProgress(today, goals).associateBy { it.macro }
    return computeTargetProgress(projectedTotals, goals).mapNotNull { projected ->
        val now = current[projected.macro] ?: return@mapNotNull null
        GoalContributionRow(
            macro = projected.macro,
            current = now.value,
            added = round1(projected.value - now.value),
            projected = projected.value,
            target = projected.target,
            currentPct = now.pct,
            projectedPct = projected.pct,
        )
    }
}

/** Where a goal bar's solid fill stops and how much the serving adds, both 0-100 (GoalContributionRows.tsx). */
fun goalBarSegments(row: GoalContributionRow): Pair<Int, Int> {
    // An edit can shrink the day: the fill then stops at the projected point.
    val base = minOf(row.currentPct.coerceAtLeast(0), FULL_BAR, row.projectedPct.coerceAtLeast(0))
    val projected = row.projectedPct.coerceIn(0, FULL_BAR)
    return base to (projected - base).coerceAtLeast(0)
}

private const val FULL_BAR = 100

/** The serving [grams] would log: an edit scales the entry's own per-100 g values, as saved (LogFoodDialog scaleEntryPreview). */
fun LogSheetState.servingAt(grams: Double): NutritionMacroTotals =
    roundMacros(scaleNutrition(editing?.per100g?.toMacros() ?: food.per100g(), grams))

/** The serving an edit replaces, which the day's totals already count; none for a new log. */
fun LogSheetState.replacedServing(): NutritionMacroTotals? = editing?.let {
    roundMacros(scaleNutrition(it.per100g.toMacros(), it.quantityG))
}
