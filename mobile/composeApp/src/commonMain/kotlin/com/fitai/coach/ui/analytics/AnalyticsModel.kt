package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.TrainingOverviewStats
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.units.metersToUserDistance
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.format.formatNumber
import kotlin.math.abs
import kotlin.math.roundToInt

/** How a stat moved against the previous period (DeltaIndicator.tsx). */
sealed interface Delta {
    data object Same : Delta

    data object New : Delta

    data class Change(val percent: Double, val better: Boolean) : Delta
}

private const val SAME_WITHIN_PCT = 0.5
private const val PERCENT = 100.0

fun delta(current: Double?, previous: Double?, lowerIsBetter: Boolean = false): Delta? {
    if (current == null || previous == null) return null
    return when {
        previous == 0.0 -> if (current == 0.0) Delta.Same else Delta.New
        else -> {
            val pct = (current - previous) / previous * PERCENT
            if (abs(pct) < SAME_WITHIN_PCT) Delta.Same else Delta.Change(pct, better = if (lowerIsBetter) pct < 0 else pct > 0)
        }
    }
}

enum class Trend { Up, Down, Flat }

private const val TREND_THRESHOLD = 0.05

/** First half of the days against the second half: more than ±5% is a trend (ExerciseProgressionTab.tsx). */
fun trend(values: List<Double>): Trend {
    val half = values.size / 2
    val first = values.take(half).average()
    val second = values.drop(half).average()
    return when {
        values.size < 2 -> Trend.Flat
        first == 0.0 -> if (second > 0) Trend.Up else Trend.Flat
        (second - first) / first > TREND_THRESHOLD -> Trend.Up
        (second - first) / first < -TREND_THRESHOLD -> Trend.Down
        else -> Trend.Flat
    }
}

/** One bar of a chart: its date (YYYY-MM-DD) and value. */
data class Bar(val date: String, val value: Double)

/** A personal record with the name to show, for listing. */
data class RecordRow(val key: String, val label: String, val record: PersonalRecord)

/** The record categories the filter offers (PersonalRecordsTab.tsx). */
val RECORD_CATEGORIES = listOf("All", "Functional", "Running", "Strength", "Conditioning")

/** Records by name, filtered to [category] ("All" keeps everything). */
fun recordRows(records: Map<String, PersonalRecord>, category: String = "All"): List<RecordRow> = records
    .filter { (_, record) -> category == "All" || record.category.equals(category, ignoreCase = true) }
    .map { (key, record) -> RecordRow(key, exerciseLabel(key, record.customLabel), record) }
    .sortedBy { it.label.lowercase() }

private const val RECENT_DAYS = 30

/** Records with any metric set in the last 30 days. */
fun recentRecords(rows: List<RecordRow>, today: String): List<RecordRow> {
    val since = addDaysToIsoDate(today, -RECENT_DAYS)
    return rows.filter { row ->
        listOfNotNull(row.record.maxWeight, row.record.maxDistance, row.record.bestTime, row.record.estimated1RM).any { it.date >= since }
    }
}

/** One headline figure of the period: what it counts, the number, its unit, and how it moved. */
data class OverviewStat(val label: String, val value: String, val unit: String? = null, val change: Delta? = null)

/**
 * The period's six headline figures (StatsGrid), each against the same-length
 * window before it. Running distance is to one decimal, as the web shows it:
 * the second was noise that also pushed the unit onto a line of its own.
 */
fun overviewStats(now: TrainingOverviewStats, before: TrainingOverviewStats?, distanceUnit: String?): List<OverviewStat> {
    val running = (metersToUserDistance(now.totalRunningMeters, distanceUnit) * ONE_DECIMAL).roundToInt() / ONE_DECIMAL
    return listOf(
        OverviewStat("Per week", formatNumber(now.avgPerWeek), change = delta(now.avgPerWeek, before?.avgPerWeek)),
        OverviewStat(
            "Workouts",
            now.totalWorkouts.toString(),
            change = delta(now.totalWorkouts.toDouble(), before?.totalWorkouts?.toDouble()),
        ),
        OverviewStat(
            "Running",
            formatNumber(running),
            if (distanceUnit == "miles") "mi" else "km",
            delta(now.totalRunningMeters, before?.totalRunningMeters),
        ),
        OverviewStat("Avg duration", formatNumber(now.avgDuration), "min", delta(now.avgDuration, before?.avgDuration)),
        OverviewStat("Avg RPE", now.avgRpe?.let(::formatNumber) ?: "—", change = delta(now.avgRpe, before?.avgRpe, lowerIsBetter = true)),
        // The percent sign belongs to the number: set apart like a unit it reads "0 %".
        OverviewStat(
            "Adherence",
            now.avgCompliancePct?.let { "${formatNumber(it)}%" } ?: "—",
            change = delta(now.avgCompliancePct, before?.avgCompliancePct),
        ),
    )
}

private const val ONE_DECIMAL = 10.0
