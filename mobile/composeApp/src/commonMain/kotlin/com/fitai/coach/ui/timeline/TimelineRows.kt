package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.TimelineEntry

/** One date on the timeline. */
data class TimelineDay(val date: String, val entries: List<TimelineEntry>, val isToday: Boolean) {
    val weekNumber: Int? get() = entries.firstNotNullOfOrNull { it.weekNumber }
}

/** The days to show, oldest first, and how many entries are folded away on either side. */
data class TimelineRows(val days: List<TimelineDay>, val hiddenPast: Int, val hiddenUpcoming: Int) {
    val todayIndex: Int get() = days.indexOfFirst { it.isToday }
}

/** How many past and upcoming days show before "show more" (the web shows 7 each way). */
const val INITIAL_DAYS = 7

/**
 * Groups [entries] by date as the web's timeline does: today always has a
 * row; the [pastDays] most recent past dates and the first [upcomingDays]
 * dates from today on are shown, oldest first; within a date the server's
 * order is kept. With [planId], only that plan's entries count.
 */
fun buildTimelineRows(
    entries: List<TimelineEntry>,
    today: String,
    planId: String? = null,
    pastDays: Int = INITIAL_DAYS,
    upcomingDays: Int = INITIAL_DAYS,
): TimelineRows {
    val byDate = linkedMapOf<String, MutableList<TimelineEntry>>()
    entries.filter { planId == null || it.planId == planId }.forEach { byDate.getOrPut(it.date) { mutableListOf() } += it }
    byDate.getOrPut(today) { mutableListOf() }

    val past = byDate.keys.filter { it < today }.sortedDescending()
    val upcoming = byDate.keys.filter { it >= today }.sorted()
    val shownPast = past.take(pastDays).reversed()
    val shownUpcoming = upcoming.take(upcomingDays)

    return TimelineRows(
        days = (shownPast + shownUpcoming).map { date -> TimelineDay(date, byDate.getValue(date), isToday = date == today) },
        hiddenPast = past.drop(pastDays).sumOf { byDate.getValue(it).size },
        hiddenUpcoming = upcoming.drop(upcomingDays).sumOf { byDate.getValue(it).size },
    )
}

/** What tapping an entry opens, by its state (the web's useTimelineSurfaceSelection). */
enum class EntrySurface { WorkoutDetail, Skipped, Preview, Log, None }

fun surfaceFor(entry: TimelineEntry, today: String): EntrySurface = when {
    entry.status == TimelineEntry.Status.Skipped -> if (entry.planDayId != null) EntrySurface.Skipped else EntrySurface.None
    entry.workoutLogId != null -> EntrySurface.WorkoutDetail
    entry.planDayId == null -> EntrySurface.None
    entry.status == TimelineEntry.Status.Planned && entry.date > today -> EntrySurface.Preview
    entry.status == TimelineEntry.Status.Planned || entry.status == TimelineEntry.Status.Missed -> EntrySurface.Log
    else -> EntrySurface.None
}

/** Whether the card offers the one-tap "done" circle: a plan day still to do, today, tomorrow or before. */
fun canQuickComplete(entry: TimelineEntry, tomorrow: String): Boolean = entry.planDayId != null &&
    entry.workoutLogId == null &&
    entry.date <= tomorrow &&
    (entry.status == TimelineEntry.Status.Planned || entry.status == TimelineEntry.Status.Missed)

/** Whether to offer fitting a missed session back in. */
fun offersRecovery(entry: TimelineEntry): Boolean = entry.status == TimelineEntry.Status.Missed &&
    entry.recoverable == true &&
    entry.planDayId != null &&
    entry.recovery != TimelineEntry.Recovery.LetGo
