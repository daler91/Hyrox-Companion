package com.fitai.coach.ui.review

import com.fitai.coach.core.api.generated.WeeklyReview
import com.fitai.coach.core.api.generated.WeeklyReviewCounts
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.weekdayIndex
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate

/** The longest "next week" line the server keeps (shared/weeklyReview.ts). */
const val INTENT_MAX_LENGTH = 280

/** From this hour on Sunday the week is "wrapping up" (WEEKLY_REVIEW_SUNDAY_EVENING_HOUR). */
private const val SUNDAY_EVENING_HOUR = 17
private const val DAYS_IN_WEEK = 7
private const val SUNDAY = 6
private const val TUESDAY = 1
private const val MINUTES_PER_HOUR = 60

/** The Monday on or before [date] (weekDates.ts mondayOf); a Sunday anchors back. */
fun mondayOf(date: String): String = weekdayIndex(date)?.let { addDaysToIsoDate(date, -it) } ?: date

/** The Monday of the most recently completed week, as of [today]. */
fun lastCompletedWeekStart(today: String): String = mondayOf(addDaysToIsoDate(today, -DAYS_IN_WEEK))

/** The timeline's nudge into the review: which week, and whether that week is still closing. */
data class ReviewPrompt(val weekStart: String, val wrappingUp: Boolean)

/**
 * The prompt for [today] at [hour], or null outside its window
 * (weeklyReviewPrompt.ts): Sunday from 5pm, for the week closing tonight,
 * then Monday and Tuesday for the week that closed. Both point at the same
 * Monday, so one dismissal holds for the whole window.
 */
fun reviewPrompt(today: String, hour: Int): ReviewPrompt? = when (weekdayIndex(today)) {
    SUNDAY -> ReviewPrompt(mondayOf(today), wrappingUp = true).takeIf { hour >= SUNDAY_EVENING_HOUR }
    in 0..TUESDAY -> ReviewPrompt(mondayOf(addDaysToIsoDate(today, -DAYS_IN_WEEK)), wrappingUp = false)
    else -> null
}

/** "Nov 2–8, 2026", "Oct 26 – Nov 1, 2026" or "Dec 28, 2026 – Jan 3, 2027" (formatWeekRange). */
fun formatWeekRange(weekStart: String, weekEnd: String): String {
    val startYear = weekStart.take(YEAR_LENGTH)
    val endYear = weekEnd.take(YEAR_LENGTH)
    val start = shortDate(weekStart)
    return when {
        startYear != endYear -> "$start, $startYear – ${shortDate(weekEnd)}, $endYear"
        weekStart.substring(
            MONTH_START,
            MONTH_END,
        ) != weekEnd.substring(MONTH_START, MONTH_END) -> "$start – ${shortDate(weekEnd)}, $endYear"
        else -> "$start–${weekEnd.substring(DAY_START).toInt()}, $endYear"
    }
}

private const val YEAR_LENGTH = 4
private const val MONTH_START = 5
private const val MONTH_END = 7
private const val DAY_START = 8

/** "45m", "1h" or "1h 30m". */
fun formatDuration(minutes: Double): String {
    val total = minutes.toInt()
    if (total < MINUTES_PER_HOUR) return "${total}m"
    val rest = total % MINUTES_PER_HOUR
    return if (rest == 0) "${total / MINUTES_PER_HOUR}h" else "${total / MINUTES_PER_HOUR}h ${rest}m"
}

/**
 * Under the plan tile: what happened to the days that weren't done
 * ("1 missed · 2 to go"), each in the timeline's own words; "All sessions
 * done" when nothing is left.
 */
fun adherenceDetail(counts: WeeklyReviewCounts): String = listOfNotNull(
    "${counts.missed} missed".takeIf { counts.missed > 0 },
    "${counts.letGo} let go".takeIf { counts.letGo > 0 },
    "${counts.skipped} skipped".takeIf { counts.skipped > 0 },
    "${counts.excused} not counted".takeIf { counts.excused > 0 },
    "${counts.outstanding} to go".takeIf { counts.outstanding > 0 },
).joinToString(" · ").ifEmpty { "All sessions done" }

/** "Runs that did their job: 3 of 4 · 1 threshold run drifted harder" (describeGradeSummary). */
fun gradeSummaryText(summary: WeeklyReview.GradeSummary): String = listOfNotNull(
    "Runs that did their job: ${summary.onTarget} of ${summary.graded}",
    summary.driftedHarder.takeIf { it > 0 }?.let { "$it threshold ${if (it == 1L) "run" else "runs"} drifted harder" },
    summary.easyTooHard.takeIf { it > 0 }?.let { "$it easy ${if (it == 1L) "run" else "runs"} not easy" },
).joinToString(" · ")

/** "+2 / −1 sets": what the athlete changed against the prescription; null when nothing. */
fun setChanges(session: WeeklyReview.SessionsItem): String? = listOfNotNull(
    session.addedSetCount?.takeIf { it > 0 }?.let { "+${formatNumber(it)}" },
    session.removedSetCount?.takeIf { it > 0 }?.let { "−${formatNumber(it)}" },
).takeIf { it.isNotEmpty() }?.joinToString(" / ", postfix = " sets")

/**
 * A planned day's badge: "Not counted" inside a declared absence (never
 * "Missed"), "Let go" for a miss the athlete chose, else its status.
 */
fun plannedDayStatus(day: WeeklyReview.PlannedDaysItem): String = when {
    day.excused -> "Not counted"
    day.status == WeeklyReview.PlannedDaysItem.Status.Missed && day.recovery == WeeklyReview.PlannedDaysItem.Recovery.LetGo -> "Let go"
    day.status == WeeklyReview.PlannedDaysItem.Status.Missed -> "Missed"
    day.status == WeeklyReview.PlannedDaysItem.Status.Skipped -> "Skipped"
    else -> "Still to do"
}

/** "Low energy" (SKIP_REASON_LABELS); null for none. */
fun skipReasonLabel(reason: WeeklyReview.PlannedDaysItem.SkipReason?): String? = when (reason) {
    WeeklyReview.PlannedDaysItem.SkipReason.Ill -> "Ill"
    WeeklyReview.PlannedDaysItem.SkipReason.Injured -> "Injured"
    WeeklyReview.PlannedDaysItem.SkipReason.Schedule -> "Schedule"
    WeeklyReview.PlannedDaysItem.SkipReason.LowEnergy -> "Low energy"
    WeeklyReview.PlannedDaysItem.SkipReason.Unknown, null -> null
}

/** "Heaviest", "Est. 1RM" (METRIC_LABELS). */
fun recordMetricLabel(metric: WeeklyReview.PersonalRecordsItem.Metric): String = when (metric) {
    WeeklyReview.PersonalRecordsItem.Metric.MaxWeight -> "Heaviest"
    WeeklyReview.PersonalRecordsItem.Metric.MaxDistance -> "Furthest"
    WeeklyReview.PersonalRecordsItem.Metric.BestTime -> "Fastest"
    WeeklyReview.PersonalRecordsItem.Metric.Estimated1Rm -> "Est. 1RM"
    WeeklyReview.PersonalRecordsItem.Metric.Unknown -> "Record"
}

/**
 * A record's value in the athlete's units (formatPersonalRecordValue): a
 * time as a clock, a distance in its stored unit (feet for a miles athlete,
 * as the records tab shows it), anything else as a weight.
 */
fun recordValue(record: WeeklyReview.PersonalRecordsItem, weightUnit: String, distanceUnit: String?): String = when (record.metric) {
    WeeklyReview.PersonalRecordsItem.Metric.BestTime -> formatClock(record.value)
    WeeklyReview.PersonalRecordsItem.Metric.MaxDistance -> "${formatNumber(record.value)} ${if (distanceUnit == "miles") "ft" else "m"}"
    else -> "${formatNumber(record.value)} $weightUnit"
}

/** "Injury" for "injury": a context note's kind, as the web capitalises it. */
fun contextLabel(type: String): String = type.replaceFirstChar { it.uppercase() }

/** Whether the week has anything to list; an empty one gets a welcome, not a report card. */
fun isEmptyWeek(review: WeeklyReview): Boolean = review.sessions.isEmpty() && review.plannedDays.isEmpty()
