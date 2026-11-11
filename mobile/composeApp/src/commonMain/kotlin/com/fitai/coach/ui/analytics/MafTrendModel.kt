package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.GetMafTestsResponse
import com.fitai.coach.core.api.generated.MafTestResult
import com.fitai.coach.core.dates.localDateOf
import com.fitai.coach.core.units.KM_TO_MILES
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.workout.formatPace

/** The training style whose athletes get the MAF trend tab (Analytics.tsx). */
const val MAF_TRAINING_STYLE = "maf_method"

/** One tagged MAF test, paired with its compliance, for the history list (MafTestRow). */
data class MafRow(
    val id: String,
    /** The workout's own day; the tag day when the workout is gone. */
    val date: String?,
    val compliancePct: Long?,
    val classification: String?,
    val durationSeconds: Double?,
    val distanceMeters: Double?,
    val avgHeartRate: Double?,
)

/** "Compliant" and its colour (MAF_CLASSIFICATION_META); an unknown one reads as itself. */
fun mafClassification(classification: String?): Pair<String, BadgeTone> = when (classification) {
    "compliant" -> "Compliant" to BadgeTone.Success
    "mostly_compliant" -> "Mostly compliant" to BadgeTone.Warning
    "over_ceiling" -> "Over ceiling" to BadgeTone.Danger
    else -> (classification ?: "Unscored") to BadgeTone.Warning
}

/**
 * The day a test belongs to: its workout's date. The tag time is only when the
 * athlete tagged the run, so it's the fallback, read as a local day.
 */
private fun testDate(workoutLogId: String?, createdAt: String?, response: GetMafTestsResponse, timeZone: String?): String? =
    workoutLogId?.let { response.workoutDates[it] } ?: createdAt?.let { localDateOf(it, timeZone) }

private data class DatedTest(val test: MafTestResult, val date: String?)

/** Each test, newest workout first (same-day tests by when they were tagged), with its compliance (buildTestRows). */
fun mafRows(response: GetMafTestsResponse, timeZone: String?): List<MafRow> {
    val analysis = response.analysis.filter { it.workoutLogId != null }.associateBy { it.workoutLogId }
    return response.tests
        .map { DatedTest(it, testDate(it.conditions?.workoutLogId, it.createdAt, response, timeZone)) }
        // Undated last; ISO dates and timestamps order as text.
        .sortedWith(compareBy<DatedTest> { it.date == null }.thenByDescending { it.date }.thenByDescending { it.test.createdAt.orEmpty() })
        .map { dated ->
            val test = dated.test
            val scored = test.conditions?.workoutLogId?.let(analysis::get)
            MafRow(
                id = test.id,
                date = dated.date,
                compliancePct = scored?.compliancePct,
                classification = scored?.classification,
                durationSeconds = test.metrics?.durationSeconds,
                distanceMeters = test.metrics?.distanceMeters,
                avgHeartRate = test.metrics?.avgHeartRate,
            )
        }
}

/** Compliance over time, oldest first, from the scored tests that have a date (buildComplianceTrendData). */
fun mafComplianceTrend(response: GetMafTestsResponse, timeZone: String?): List<Point> = response.analysis
    .mapNotNull { scored ->
        val pct = scored.compliancePct ?: return@mapNotNull null
        testDate(scored.workoutLogId, scored.createdAt, response, timeZone)?.let { Point(it, pct.toDouble()) }
    }
    .sortedBy { it.date }

/** Speed from a distance and a time; null unless both are positive (shared/maf). */
fun metersPerSecond(distanceMeters: Double?, durationSeconds: Double?): Double? {
    val distance = distanceMeters?.takeIf { it > 0 } ?: return null
    return durationSeconds?.takeIf { it > 0 }?.let { distance / it }
}

private const val METRES_PER_KM = 1000.0

/** Seconds per km or mile: the number behind a pace (paceSecondsPerUnit). */
fun paceSecondsPerUnit(metersPerSecond: Double, distanceUnit: String?): Double? {
    if (metersPerSecond.isNaN() || metersPerSecond <= 0) return null
    val perKm = METRES_PER_KM / metersPerSecond
    return if (distanceUnit == "miles") perKm / KM_TO_MILES else perKm
}

/** Pace over time, oldest first; lower is faster, which is the point of MAF testing (buildPaceTrendData). */
fun mafPaceTrend(rows: List<MafRow>, distanceUnit: String?): List<Point> = rows
    .mapNotNull { row ->
        val pace = metersPerSecond(row.distanceMeters, row.durationSeconds)?.let { paceSecondsPerUnit(it, distanceUnit) }
        if (pace == null || row.date == null) null else Point(row.date, pace)
    }
    .sortedBy { it.date }

/** "8:30/km · 42:30 · 142 bpm": what the row has of pace, time and heart rate. */
fun mafRowDetail(row: MafRow, distanceUnit: String?): String = listOfNotNull(
    metersPerSecond(row.distanceMeters, row.durationSeconds)?.let { formatPace(it, distanceUnit) },
    row.durationSeconds?.let(::formatSplit),
    row.avgHeartRate?.let { "${formatNumber(it)} bpm" },
).joinToString(" · ")

private const val YEAR_LENGTH = 4

/** "Nov 10, 2026", or "—" with no date. */
fun mafTestDate(date: String?): String = date?.let { "${shortDate(it)}, ${it.take(YEAR_LENGTH)}" } ?: "—"

/** "1 MAF test", "3 MAF tests". */
fun mafCountLabel(count: Int): String = "$count MAF test${if (count == 1) "" else "s"}"

/** "Latest: 85% · Compliant"; null when the newest test had no heart rate to score. */
fun mafLatestLabel(row: MafRow): String? = row.compliancePct?.let { "Latest: $it% · ${mafClassification(row.classification).first}" }
