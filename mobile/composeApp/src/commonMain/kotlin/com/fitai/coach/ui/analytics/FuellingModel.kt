package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.GetNutritionBlockResponse
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.ui.format.formatNumber
import kotlin.math.abs

private typealias BlockDay = GetNutritionBlockResponse.PointsItem

/** A day "hits" its carbs at 90% of its (load-adjusted) target or more. */
const val CARB_HIT_RATIO = 0.9

/** Each group needs this many days before a comparison is reported. */
const val MIN_DAYS_PER_BUCKET = 3

private const val PERCENT = 100

/** One outcome on carb-hit days against missed days; for RPE a negative [delta] felt easier. */
data class MetricComparison(val hitDays: Int, val missDays: Int, val hitAvg: Double, val missAvg: Double, val delta: Double)

/** The comparison, or why there isn't one yet (FuellingCorrelationResult). */
data class FuellingCorrelation(
    val rpe: MetricComparison?,
    val compliance: MetricComparison?,
    /** Days with food logged, a carb target and an outcome to compare. */
    val eligibleDays: Int,
) {
    val ok: Boolean get() = rpe != null || compliance != null
    val carbHitPct: Int get() = jsRound(CARB_HIT_RATIO * PERCENT).toInt()
}

/** Food was logged that day, it had a carb target, and training left an RPE or a compliance. */
private fun isEligible(day: BlockDay): Boolean =
    day.calories > 0 && (day.carbTargetG ?: 0.0) > 0 && (day.avgRpe != null || day.compliancePct != null)

private fun isHit(day: BlockDay): Boolean = day.carb >= CARB_HIT_RATIO * (day.carbTargetG ?: 0.0)

private const val TENTHS = 10

private fun round1(n: Double): Double = jsRound(n * TENTHS) / TENTHS

private fun compare(days: List<Pair<Boolean, Double>>, round: (Double) -> Double): MetricComparison? {
    val hit = days.filter { it.first }.map { it.second }
    val miss = days.filterNot { it.first }.map { it.second }
    if (hit.size < MIN_DAYS_PER_BUCKET || miss.size < MIN_DAYS_PER_BUCKET) return null
    // The difference comes from the raw means, so rounding can't drift it.
    return MetricComparison(hit.size, miss.size, round(hit.average()), round(miss.average()), round(hit.average() - miss.average()))
}

/**
 * Session RPE and compliance on days the athlete reached their carb target
 * against days they didn't (analyzeFuellingCorrelation). Only days with food
 * logged count, so an unlogged day isn't read as a miss.
 */
fun fuellingCorrelation(points: List<BlockDay>): FuellingCorrelation {
    val eligible = points.filter(::isEligible)
    val rpe = eligible.mapNotNull { day -> day.avgRpe?.let { isHit(day) to it } }
    val compliance = eligible.mapNotNull { day -> day.compliancePct?.let { isHit(day) to it } }
    return FuellingCorrelation(compare(rpe, ::round1), compare(compliance, ::jsRound), eligible.size)
}

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

/** What the comparison counts and how to read it. */
val FUELLING_EXPLANATION: String =
    "Compares training days where you reached at least ${jsRound(CARB_HIT_RATIO * PERCENT).toInt()}% of your carb target with " +
        "days you didn't (minimum $MIN_DAYS_PER_BUCKET days per group). Only days with food logged count, so a day you didn't log " +
        "is not read as a miss. An association, not causation — guidance only."
