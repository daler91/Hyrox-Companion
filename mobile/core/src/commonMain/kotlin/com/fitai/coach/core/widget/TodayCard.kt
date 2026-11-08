package com.fitai.coach.core.widget

import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TimelineEntry.Status

/** What the "Today's session" widget shows. */
public data class TodayCard(
    val title: String,
    val detail: String?,
    val state: State,
    /** Other sessions on the day, beyond the one shown. */
    val more: Int = 0,
) {
    public enum class State { Planned, Done, Skipped, Rest, SignedOut }

    public companion object {
        public val SignedOut: TodayCard = TodayCard("Today's session", "Open fitai to sign in.", State.SignedOut)
    }
}

/**
 * The widget's card for [today] from the timeline as stored on the device:
 * the first session still to do, else the first one done, else one skipped
 * or missed; a rest day when nothing is on it.
 */
public fun todayCard(entries: List<TimelineEntry>, today: String): TodayCard {
    val day = entries.filter { it.date == today }
    val shown = day.firstOrNull { it.status == Status.Planned }
        ?: day.firstOrNull { it.status == Status.Completed }
        ?: day.firstOrNull()
        ?: return TodayCard("Rest day", "Nothing planned today.", TodayCard.State.Rest)
    val (detail, state) = when (shown.status) {
        Status.Planned -> shown.mainWorkout.ifBlank { null } to TodayCard.State.Planned
        Status.Completed -> "Done. Nice work." to TodayCard.State.Done
        Status.Missed -> "Missed" to TodayCard.State.Skipped
        else -> "Skipped" to TodayCard.State.Skipped
    }
    return TodayCard(title = shown.focus.ifBlank { "Workout" }, detail = detail, state = state, more = day.size - 1)
}
