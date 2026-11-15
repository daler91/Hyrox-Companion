package com.fitai.coach.ui.coach

import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.shortWeekday

/** A row of the conversation as shown (chatTranscript.ts): where a new day starts, or a message. */
sealed interface TranscriptRow {
    /** Before a day's first message; the bubbles under it show only the time. */
    data class Day(val key: String, val label: String) : TranscriptRow

    data class Message(val item: ChatItem) : TranscriptRow
}

private const val YEAR_LENGTH = 4

/** "Today", "Yesterday", else "Tue, Sep 29", with the year when it isn't [today]'s (chatDayLabel). */
fun chatDayLabel(date: String, today: String): String = when (date) {
    today -> "Today"
    addDaysToIsoDate(today, -1) -> "Yesterday"
    else -> {
        val year = date.take(YEAR_LENGTH).takeIf { it != today.take(YEAR_LENGTH) }?.let { ", $it" }.orEmpty()
        "${shortWeekday(date)}, ${shortDate(date)}$year"
    }
}

/**
 * Port of `buildTranscript`: [items] in order, with a day row ahead of each
 * day's first message. [dayOf] is the local date (YYYY-MM-DD) a send time
 * falls on. A message with no send time (the greeting) starts no day.
 */
fun buildTranscript(items: List<ChatItem>, today: String, dayOf: (String) -> String?): List<TranscriptRow> {
    val rows = mutableListOf<TranscriptRow>()
    var lastDay: String? = null
    for (item in items) {
        val day = item.sentAt?.let(dayOf)
        if (day != null && day != lastDay) {
            rows += TranscriptRow.Day("day-${rows.size}-$day", chatDayLabel(day, today))
            lastDay = day
        }
        rows += TranscriptRow.Message(item)
    }
    return rows
}
