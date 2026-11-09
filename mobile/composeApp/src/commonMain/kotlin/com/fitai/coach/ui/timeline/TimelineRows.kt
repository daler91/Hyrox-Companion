package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.dates.addDaysToIsoDate

/** One date on the timeline. */
data class TimelineDay(
    val date: String,
    val entries: List<TimelineEntry>,
    val isToday: Boolean,
    /** Training notes that start this day (injury, illness, travel, rest). */
    val annotations: List<TimelineAnnotation> = emptyList(),
) {
    val weekNumber: Int? get() = entries.firstNotNullOfOrNull { it.weekNumber }
}

/** The days to show, oldest first, and how many entries are folded away on either side. */
data class TimelineRows(val days: List<TimelineDay>, val hiddenPast: Int, val hiddenUpcoming: Int) {
    val todayIndex: Int get() = days.indexOfFirst { it.isToday }
}

/** How many past and upcoming days show before "show more" (the web shows 7 each way). */
const val INITIAL_DAYS = 7

/** What the timeline narrows to: one plan's entries, and entries in one state; null for any. */
data class TimelineFilter(val planId: String? = null, val status: TimelineEntry.Status? = null) {
    fun matches(entry: TimelineEntry): Boolean = (planId == null || entry.planId == planId) && (status == null || entry.status == status)
}

/**
 * Groups [entries] by date as the web's timeline does: today always has a
 * row (unless a status filter is on: an empty "today" says nothing about
 * skipped sessions); the [pastDays] most recent past dates and the first
 * [upcomingDays] dates from today on are shown, oldest first; within a date
 * the server's order is kept. Only entries [filter] matches count.
 */
fun buildTimelineRows(
    entries: List<TimelineEntry>,
    today: String,
    filter: TimelineFilter = TimelineFilter(),
    pastDays: Int = INITIAL_DAYS,
    upcomingDays: Int = INITIAL_DAYS,
): TimelineRows {
    val byDate = linkedMapOf<String, MutableList<TimelineEntry>>()
    entries.filter(filter::matches).forEach { byDate.getOrPut(it.date) { mutableListOf() } += it }
    if (filter.status == null) byDate.getOrPut(today) { mutableListOf() }

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

/** The timeline's status filter (the web's All / Completed / Planned / Missed / Skipped). */
val STATUS_FILTERS: List<Pair<TimelineEntry.Status?, String>> = listOf(
    null to "All",
    TimelineEntry.Status.Completed to "Completed",
    TimelineEntry.Status.Planned to "Planned",
    TimelineEntry.Status.Missed to "Missed",
    TimelineEntry.Status.Skipped to "Skipped",
)

/** The earliest date a session can be moved to: a year typed digit by digit passes through 0002 (MoveEntryMenu). */
const val MIN_MOVE_DATE = "2000-01-01"

/** Where a session can be moved: a plan day or a logged workout. */
fun canMove(entry: TimelineEntry): Boolean = entry.planDayId != null || entry.workoutLogId != null

/**
 * The latest date a session can move to: a logged workout no later than
 * tomorrow (the server refuses a workout dated after it); a plan day any time.
 */
fun latestMoveDate(entry: TimelineEntry, tomorrow: String): String? = if (entry.workoutLogId != null) tomorrow else null

/** Whether [date] is somewhere [entry] can go: another day, in the allowed window. */
fun canMoveTo(entry: TimelineEntry, date: String, tomorrow: String): Boolean =
    date.length == ISO_DATE_LENGTH && date != entry.date && date >= MIN_MOVE_DATE &&
        latestMoveDate(entry, tomorrow).let { it == null || date <= it }

/** A quick move from the card's menu: its label and date. */
data class QuickMove(val label: String, val date: String)

/**
 * The card menu's quick moves (MoveEntryMenu): today, tomorrow and, for a
 * plan day, next week; each only when it is somewhere the session can go.
 */
fun quickMoves(entry: TimelineEntry, today: String): List<QuickMove> {
    val tomorrow = addDaysToIsoDate(today, 1)
    return listOfNotNull(
        QuickMove("Move to today", today),
        QuickMove("Move to tomorrow", tomorrow),
        QuickMove("Move to next week", addDaysToIsoDate(today, DAYS_PER_WEEK)).takeIf { entry.workoutLogId == null },
    ).filter { canMoveTo(entry, it.date, tomorrow) }
}

/** "Instead of skipping": tomorrow or next week (SkipConfirmDialog's quick moves). */
fun skipMoves(today: String): List<QuickMove> =
    listOf(QuickMove("Tomorrow", addDaysToIsoDate(today, 1)), QuickMove("Next week", addDaysToIsoDate(today, DAYS_PER_WEEK)))

private const val ISO_DATE_LENGTH = 10
private const val DAYS_PER_WEEK = 7

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
