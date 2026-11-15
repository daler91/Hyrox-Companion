package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.GetNutritionBlockResponse
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.ui.format.formatNumber
import kotlin.math.abs

private typealias BlockDay = GetNutritionBlockResponse.PointsItem

/** One outcome on carb-hit days against missed days; for RPE a negative [delta] felt easier. */
data class MetricComparison(val hitDays: Long, val missDays: Long, val hitAvg: Double, val missAvg: Double, val delta: Double)

/**
 * The server's comparison of carb-hit days with missed ones (the block's
 * `correlation`, analyzeFuellingCorrelation), as the card reads it: each
 * outcome compared once both groups have enough days, or null.
 */
data class FuellingCorrelation(
    val rpe: MetricComparison?,
    val compliance: MetricComparison?,
    /** Days with food logged, a carb target and an outcome to compare. */
    val eligibleDays: Long,
    /** A day hits its carbs at this percentage of its target. */
    val carbHitPct: Long,
    /** How the comparison is made, in the server's words. */
    val explanation: String,
) {
    val ok: Boolean get() = rpe != null || compliance != null

    companion object {
        fun of(correlation: GetNutritionBlockResponse.Correlation) = FuellingCorrelation(
            rpe = correlation.rpe?.run { MetricComparison(hitDays, missDays, hitAvg, missAvg, delta) },
            compliance = correlation.compliance?.run { MetricComparison(hitDays, missDays, hitAvg, missAvg, delta) },
            eligibleDays = correlation.eligibleDays,
            carbHitPct = correlation.carbHitPct,
            explanation = correlation.explanation,
        )
    }
}

private const val TENTHS = 10

private fun round1(n: Double): Double = jsRound(n * TENTHS) / TENTHS

/** The tab shows once any day in the range has food logged. */
fun hasIntake(points: List<BlockDay>): Boolean = points.any { it.calories > 0 }

private const val RPE_NOISE = 0.3
private const val COMPLIANCE_NOISE = 3

/** "0.9 lower (felt easier)", or "no clear difference" inside the noise. */
fun rpeDeltaText(comparison: MetricComparison): String {
    if (abs(comparison.delta) < RPE_NOISE) return "no clear difference"
    val magnitude = formatNumber(round1(abs(comparison.delta)))
    return if (comparison.delta < 0) "$magnitude lower (felt easier)" else "$magnitude higher (felt harder)"
}

/** "6 pts better", or "about the same" inside the noise. */
fun complianceDeltaText(comparison: MetricComparison): String = when {
    abs(comparison.delta) < COMPLIANCE_NOISE -> "about the same"
    comparison.delta > 0 -> "${formatNumber(comparison.delta)} pts better"
    else -> "${formatNumber(abs(comparison.delta))} pts worse"
}

/** "7.1 on carb-hit days (4) vs 7.8 missed (3) — 0.7 lower (felt easier)". */
fun comparisonLine(comparison: MetricComparison, format: (Double) -> String, delta: String): String =
    "${format(comparison.hitAvg)} on carb-hit days (${comparison.hitDays}) vs ${format(comparison.missAvg)} missed " +
        "(${comparison.missDays}) — $delta"
