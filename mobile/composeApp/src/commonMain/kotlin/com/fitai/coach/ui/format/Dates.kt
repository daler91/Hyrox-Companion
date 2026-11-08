package com.fitai.coach.ui.format

import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.weekdayName

private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
private const val DATE_LENGTH = 10
private const val MONTH_START = 5
private const val MONTH_END = 7
private const val DAY_START = 8

/** "Nov 3" for 2026-11-03; the input itself when it isn't a YYYY-MM-DD date. */
fun shortDate(date: String): String {
    val month = date.takeIf { it.length >= DATE_LENGTH }?.substring(MONTH_START, MONTH_END)?.toIntOrNull()?.let { MONTHS.getOrNull(it - 1) }
    val day = date.takeIf { it.length >= DATE_LENGTH }?.substring(DAY_START, DATE_LENGTH)?.toIntOrNull()
    return if (month != null && day != null) "$month $day" else date
}

/** "Today", "Tomorrow", "Yesterday", else "Monday, Nov 3", as the web's timeline labels a day. */
fun dayLabel(date: String, today: String): String = when (date) {
    today -> "Today"
    addDaysToIsoDate(today, 1) -> "Tomorrow"
    addDaysToIsoDate(today, -1) -> "Yesterday"
    else -> "${weekdayName(date)}, ${shortDate(date)}"
}

/** Short weekday, "Mon". */
fun shortWeekday(date: String): String = weekdayName(date).take(WEEKDAY_ABBREVIATION)

private const val WEEKDAY_ABBREVIATION = 3

/** "Monday, Nov 9, 2026": a date with its weekday and year, for dates that may be months away. */
fun longDate(date: String): String = "${weekdayName(date)}, ${shortDate(date)}, ${date.take(YEAR_LENGTH)}"

private const val YEAR_LENGTH = 4
