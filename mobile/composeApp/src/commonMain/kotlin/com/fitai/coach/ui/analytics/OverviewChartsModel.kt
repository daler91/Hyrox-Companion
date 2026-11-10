package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.core.api.generated.TrainingOverviewAcwrZone
import com.fitai.coach.core.api.generated.TrainingOverviewHrZone
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.units.metersToUserDistance
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.review.mondayOf
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

private typealias TrendItem = TrainingOverview.TrainingLoad.TrendItem

/** One point on a line chart. */
data class Point(val date: String, val value: Double)

/** A line's colour, matched to the palette where it's drawn. */
enum class SeriesColor { Primary, Blue, Green, Amber, Red, Purple }

data class LineSeries(val label: String, val points: List<Point>, val color: SeriesColor)

/** A horizontal stripe of the chart, from one value to another (the ACWR zones). */
data class ZoneBand(val from: Double, val to: Double, val color: SeriesColor)

/** A dashed rule across the chart at [value], with what it marks. */
data class Reference(val value: Double, val label: String? = null, val color: SeriesColor? = null)

/** A line needs two points before it says anything (the web's `length > 1`). */
const val MIN_LINE_POINTS = 2

fun List<Point>.isLine(): Boolean = size >= MIN_LINE_POINTS

/** The trend's days that have [value], in order. */
fun trendPoints(trend: List<TrendItem>, value: (TrendItem) -> Double?): List<Point> =
    trend.mapNotNull { point -> value(point)?.let { Point(point.date, it) } }

// --- Training Load Governor (AcwrTrendChart) ---

/** "Sweet spot": the ACWR zone in words. */
fun acwrZoneLabel(zone: TrainingOverviewAcwrZone): String = when (zone) {
    TrainingOverviewAcwrZone.Undertraining -> "Under-training"
    TrainingOverviewAcwrZone.SweetSpot -> "Sweet spot"
    TrainingOverviewAcwrZone.Yellow -> "Yellow load"
    TrainingOverviewAcwrZone.Danger -> "Danger load"
    TrainingOverviewAcwrZone.InsufficientData, TrainingOverviewAcwrZone.Unknown -> "Insufficient data"
}

fun acwrZoneTone(zone: TrainingOverviewAcwrZone): BadgeTone = when (zone) {
    TrainingOverviewAcwrZone.Undertraining -> BadgeTone.Accent
    TrainingOverviewAcwrZone.SweetSpot -> BadgeTone.Success
    TrainingOverviewAcwrZone.Yellow -> BadgeTone.Warning
    TrainingOverviewAcwrZone.Danger -> BadgeTone.Danger
    TrainingOverviewAcwrZone.InsufficientData, TrainingOverviewAcwrZone.Unknown -> BadgeTone.Neutral
}

/** "1.12", or "N/A" with no ratio yet (toFixed(2)). */
fun formatRatio(value: Double?): String = value?.let(::fixed2) ?: "N/A"

/** "UTSS 412 - ACWR 1.12". */
fun governorSubtitle(load: TrainingOverview.TrainingLoad): String =
    "UTSS ${load.currentUtss.roundToInt()} - ACWR ${formatRatio(load.acwr)}"

private const val ACWR_LOW = 0.8
private const val ACWR_HIGH = 1.3
private const val ACWR_DANGER = 1.5
private const val ACWR_MIN_TOP = 2.0

/** The ACWR axis tops out at 2, or the highest ratio if that's higher. */
fun acwrTop(points: List<Point>): Double = maxOf(ACWR_MIN_TOP, points.maxOfOrNull { it.value } ?: 0.0)

/** Under-training, the sweet spot, yellow and danger, bottom to top. */
fun acwrBands(top: Double): List<ZoneBand> = listOf(
    ZoneBand(0.0, ACWR_LOW, SeriesColor.Blue),
    ZoneBand(ACWR_LOW, ACWR_HIGH, SeriesColor.Green),
    ZoneBand(ACWR_HIGH, ACWR_DANGER, SeriesColor.Amber),
    ZoneBand(ACWR_DANGER, top, SeriesColor.Red),
)

val ACWR_REFERENCES = listOf(Reference(ACWR_LOW), Reference(ACWR_HIGH), Reference(ACWR_DANGER))

/** How a number reads beside the chart: fine, building up, or a warning. */
enum class StatTone { Plain, Muted, Good, Caution, Bad }

private const val TSB_FRESH = 5.0
private const val TSB_DEEP_FATIGUE = -25.0

/** "+12" fresh, "-8" building fatigue, "-30" deep fatigue (tsbClass). */
fun tsbTone(tsb: Double?): StatTone = when {
    tsb == null -> StatTone.Plain
    tsb >= TSB_FRESH -> StatTone.Good
    tsb <= TSB_DEEP_FATIGUE -> StatTone.Bad
    tsb < 0 -> StatTone.Caution
    else -> StatTone.Plain
}

/** "N/A" with no load to measure; else signed. */
fun formatForm(tsb: Double?): String = tsb?.let(::formatTsb) ?: "N/A"

/** Unknown is an absent measurement, so it reads muted rather than fine. */
fun monotonyTone(zone: TrainingOverview.TrainingLoad.MonotonyZone): StatTone = when (zone) {
    TrainingOverview.TrainingLoad.MonotonyZone.Ok -> StatTone.Plain
    TrainingOverview.TrainingLoad.MonotonyZone.Elevated -> StatTone.Caution
    TrainingOverview.TrainingLoad.MonotonyZone.HighRisk -> StatTone.Bad
    else -> StatTone.Muted
}

fun restrictionsLabel(count: Int): String = "$count active restriction${if (count == 1) "" else "s"}"

// --- Form & monotony (FormMonotonyTrendCharts) ---

private const val MONOTONY_RISK = 2.0

val FORM_REFERENCE = Reference(0.0, "Fresh / fatigued")
val MONOTONY_REFERENCE = Reference(MONOTONY_RISK, "Overtraining risk", SeriesColor.Red)

// --- Objective load (ObjectiveLoadTrendCharts) ---

/** UTSS, with hrTSS and power TSS beside it when there's enough of each. */
fun objectiveLoadSeries(trend: List<TrendItem>): List<LineSeries> {
    val hrTss = trendPoints(trend) { it.hrTss }
    val tss = trendPoints(trend) { it.tss }
    return listOfNotNull(
        LineSeries("UTSS (subjective)", trendPoints(trend) { it.utss }, SeriesColor.Primary),
        LineSeries("hrTSS (HR)", hrTss, SeriesColor.Purple).takeIf { hrTss.isLine() },
        LineSeries("Power TSS (est.)", tss, SeriesColor.Blue).takeIf { tss.isLine() },
    )
}

/** Fitness and fatigue, from the days that have both. */
fun fitnessFatigueSeries(trend: List<TrendItem>): List<LineSeries> {
    val days = trend.filter { it.chronicEwma != null && it.acuteEwma != null }
    return listOf(
        LineSeries("Fitness (chronic)", trendPoints(days) { it.chronicEwma }, SeriesColor.Green),
        LineSeries("Fatigue (acute)", trendPoints(days) { it.acuteEwma }, SeriesColor.Amber),
    )
}

/** "Recovery" … "VO2max" (HR_ZONE_LABELS). */
fun hrZoneLabel(zone: TrainingOverviewHrZone): String = when (zone) {
    TrainingOverviewHrZone.Z1 -> "Recovery"
    TrainingOverviewHrZone.Z2 -> "Aerobic"
    TrainingOverviewHrZone.Z3 -> "Tempo"
    TrainingOverviewHrZone.Z4 -> "Threshold"
    TrainingOverviewHrZone.Z5 -> "VO2max"
    TrainingOverviewHrZone.Unknown -> "Zone"
}

/** "Z2 118–136". */
fun hrZoneRange(zone: TrainingOverview.TrainingLoad.HrZonesItem): String =
    "${zone.zone.wireValue.uppercase()} ${zone.minHr.roundToInt()}–${zone.maxHr.roundToInt()}"

// --- Weekly trends (OverviewTrendCharts) ---

fun avgRpePoints(weeks: List<TrainingOverview.WeeklySummariesItem>): List<Point> =
    weeks.mapNotNull { week -> week.avgRpe?.let { Point(week.weekStart, it) } }

/** Minutes per workout that logged a duration, as the stat card divides. */
fun avgDurationPoints(weeks: List<TrainingOverview.WeeklySummariesItem>): List<Point> = weeks
    .filter { it.workoutsWithDuration > 0 }
    .map { Point(it.weekStart, (it.totalDuration / it.workoutsWithDuration).roundToInt().toDouble()) }

/** Running per week in the athlete's units; nothing when no week has any. */
fun runningPoints(weeks: List<TrainingOverview.WeeklySummariesItem>, distanceUnit: String?): List<Point> =
    if (weeks.none { it.runningMeters > 0 }) {
        emptyList()
    } else {
        weeks.map { Point(it.weekStart, metersToUserDistance(it.runningMeters, distanceUnit)) }
    }

// --- Annotation bands (WeeklyWorkoutsChart) ---

/** An annotation's span on the weekly chart: the first and last week it touches. */
data class WeekBand(val from: Int, val to: Int, val type: TimelineAnnotation.Type)

private const val WEEK_LAST_DAY = 6

/** The weeks each annotation overlaps, as indexes into [weekStarts] (annotationToWeekBounds). */
fun annotationBands(weekStarts: List<String>, annotations: List<TimelineAnnotation>): List<WeekBand> = annotations.mapNotNull { note ->
    val touched = weekStarts.indices.filter { i ->
        weekStarts[i] <= note.endDate && addDaysToIsoDate(weekStarts[i], WEEK_LAST_DAY) >= note.startDate
    }
    if (touched.isEmpty()) null else WeekBand(touched.min(), touched.max(), note.type)
}

// --- Consistency heatmap (WorkoutHeatmap) ---

const val HEATMAP_WEEKS = 16
private const val DAYS_IN_WEEK = 7

enum class DayState { Workout, Rest, OutOfRange, Future }

data class HeatDay(val date: String, val state: DayState)

/**
 * Sixteen Monday-to-Sunday weeks ending with this one. A day before
 * [rangeStart] was never fetched, so it shows as out of range rather than as
 * a rest day.
 */
fun consistencyWeeks(today: String, workoutDates: List<String>, rangeStart: String?): List<List<HeatDay>> {
    val logged = workoutDates.toSet()
    val first = addDaysToIsoDate(mondayOf(today), -(HEATMAP_WEEKS - 1) * DAYS_IN_WEEK)
    return List(HEATMAP_WEEKS) { week ->
        List(DAYS_IN_WEEK) { day ->
            val date = addDaysToIsoDate(first, week * DAYS_IN_WEEK + day)
            val state = when {
                date > today -> DayState.Future
                rangeStart != null && date < rangeStart -> DayState.OutOfRange
                date in logged -> DayState.Workout
                else -> DayState.Rest
            }
            HeatDay(date, state)
        }
    }
}

/**
 * "Nov" over the first week of each month, by the week's Monday; a month
 * with under two columns before the next is left unlabelled, so "Jul" and
 * "Aug" can't run together at the left edge.
 */
fun monthLabels(weeks: List<List<HeatDay>>): List<String?> {
    val starts = weeks.indices.filter { i ->
        i == 0 || weeks[i].first().date.substring(MONTH_START, MONTH_END) != weeks[i - 1].first().date.substring(MONTH_START, MONTH_END)
    }
    return weeks.indices.map { i ->
        val next = starts.firstOrNull { it > i } ?: weeks.size
        if (i in starts && next - i >= MIN_LABEL_COLUMNS) shortDate(weeks[i].first().date).substringBefore(' ') else null
    }
}

private const val MIN_LABEL_COLUMNS = 2
private const val MONTH_START = 5
private const val MONTH_END = 7

// --- Numbers ---

private const val HUNDREDTHS = 100

/** Two decimals, always (toFixed(2)). */
fun fixed2(value: Double): String {
    val hundredths = (abs(value) * HUNDREDTHS).roundToLong()
    val text = "${hundredths / HUNDREDTHS}.${(hundredths % HUNDREDTHS).toString().padStart(2, '0')}"
    return if (value < 0 && hundredths != 0L) "-$text" else text
}
