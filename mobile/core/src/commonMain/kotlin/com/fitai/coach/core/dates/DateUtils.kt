package com.fitai.coach.core.dates

import com.fitai.coach.core.js.jsRound
import kotlin.math.floor

/*
 * Plan-scheduling date helpers, ported from shared/dateUtils.ts: the plan
 * form's live week count (the rule the server's Zod schema applies), start-date
 * defaults, and the weekday an optimistic move stamps.
 *
 * Every function takes and returns `YYYY-MM-DD` strings and does its math at
 * UTC midnight, so the device timezone never matters. Like the TypeScript,
 * they also accept strings that are not real dates and answer what JS would:
 * "2026-02-30" is read as 2 March, "0050-01-01" as 1950, and a string that does
 * not parse at all gives null where the TypeScript gives NaN (or the literal
 * "NaN-NaN-NaN" where it returns a date string). Check input with
 * [isIsoCalendarDate] where that matters. Pinned by the `dateUtils.*` golden
 * fixtures; see docs/mobile-shared-logic.md.
 */

/** `MIN_PLAN_WEEKS`: the shortest plan, in weeks. */
public const val MIN_PLAN_WEEKS: Int = 1

/** `MAX_PLAN_WEEKS`: the longest plan, in weeks. */
public const val MAX_PLAN_WEEKS: Int = 24

/**
 * `PLAN_WEEKDAYS`: plan-day names, Monday first. A plan's week 1 is the
 * Monday-anchored week that contains its start date.
 */
public val PLAN_WEEKDAYS: List<String> =
    listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

/**
 * `dayDiff`: whole days from [startDate] to [endDate], computed in UTC so it is
 * DST-safe. Positive when [endDate] is later; zero or negative otherwise.
 * Null (TS: NaN) when either date does not parse.
 */
public fun dayDiff(startDate: String, endDate: String): Int? =
    jsRound((toUtcEpoch(endDate) - toUtcEpoch(startDate)) / MS_PER_DAY).toIntOrNull()

/**
 * `planSpanWeeks`: plan length in weeks from a start to an end date, not
 * clamped. It is the count the server's plan length, the Zod schema and the
 * plan form's range check all read.
 *
 * Normally `round(days / 7)` (not ceil: 56 days is 8 weeks). When
 * [endDateIsRaceDate] (TS: `options.endDateIsRaceDate`), the race must fall
 * inside the plan, so the plan runs from week 1's Monday through the week that
 * holds the race. Null (TS: NaN) when either date does not parse.
 */
public fun planSpanWeeks(startDate: String, endDate: String, endDateIsRaceDate: Boolean = false): Int? =
    if (endDateIsRaceDate) {
        dayDiff(planWeekOneMonday(startDate), endDate)?.let { floor(it / 7.0).toInt() + 1 }
    } else {
        dayDiff(startDate, endDate)?.let { jsRound(it / 7.0).toInt() }
    }

/**
 * `computePlanWeeks`: [planSpanWeeks] clamped to
 * [MIN_PLAN_WEEKS]..[MAX_PLAN_WEEKS], as a last line of defence for the DB
 * write. The form and the schema reject an out-of-range span instead. Null
 * (TS: NaN) when either date does not parse.
 */
public fun computePlanWeeks(startDate: String, endDate: String, endDateIsRaceDate: Boolean = false): Int? =
    planSpanWeeks(startDate, endDate, endDateIsRaceDate)?.coerceIn(MIN_PLAN_WEEKS, MAX_PLAN_WEEKS)

/**
 * `isIsoCalendarDate`: whether [value] is a real calendar day written
 * `YYYY-MM-DD`, i.e. it survives a round trip through UTC midnight unchanged.
 * That refuses "2026-02-30" (rolls into March), a year that is not four digits
 * ("20266-11-15", "2026-1-5"), surrounding whitespace, and the years 0000–0099,
 * which JS reads as 1900–1999.
 */
public fun isIsoCalendarDate(value: String): Boolean {
    val epoch = toUtcEpoch(value)
    return !epoch.isNaN() && isoDateUtc(epoch) == value
}

/**
 * `addDaysToISODate`: [date] plus [days] whole days, in UTC.
 *
 * Prints what the TypeScript prints: the year without zero-padding (year 100 is
 * "100-01-01", and years can go negative), and "NaN-NaN-NaN" when [date] does
 * not parse or the result is outside the JS Date range (±100,000,000 days from
 * 1970-01-01). The TS takes any number of days; whole days are its domain.
 */
public fun addDaysToIsoDate(date: String, days: Int): String {
    val time = timeClip(toUtcEpoch(date) + days * MS_PER_DAY)
    if (time.isNaN()) return INVALID_DATE_TEXT
    val utc = utcDate(time)
    return "${utc.year}-${utc.month.pad2()}-${utc.day.pad2()}"
}

/** `weekdayIndex`: 0 for a Monday through 6 for a Sunday. Null (TS: NaN) when [date] does not parse. */
public fun weekdayIndex(date: String): Int? {
    val time = timeClip(toUtcEpoch(date))
    if (time.isNaN()) return null
    return (utcWeekday(time) + 6) % 7
}

/** `weekdayName`: the weekday [date] falls on, "Monday" … "Sunday"; "Monday" when it does not parse. */
public fun weekdayName(date: String): String = weekdayIndex(date)?.let(PLAN_WEEKDAYS::get) ?: "Monday"

/** `planWeekOneMonday`: the Monday that opens week 1 of a plan starting on [startDate]. */
public fun planWeekOneMonday(startDate: String): String {
    val index = weekdayIndex(startDate) ?: return INVALID_DATE_TEXT
    return addDaysToIsoDate(startDate, -index)
}

/**
 * `weekOneDaysBeforeStart`: week 1's day names that fall before [startDate],
 * which scheduling leaves off the calendar instead of back-dating. Empty for a
 * Monday start, and for a date that does not parse.
 */
public fun weekOneDaysBeforeStart(startDate: String): List<String> = PLAN_WEEKDAYS.take(weekdayIndex(startDate) ?: 0)

/**
 * `nextPlanStartDate`: the first Monday on or after [today], the default of
 * every start-date picker. A Monday [today] is returned exactly as given.
 *
 * [today] is the caller's local calendar date as `YYYY-MM-DD`: the web passes
 * the browser's local date, so the app should pass the device's (see "Whose
 * today?" in docs/mobile-shared-logic.md). This function never reads a clock.
 */
public fun nextPlanStartDate(today: String): String {
    val index = weekdayIndex(today) ?: return INVALID_DATE_TEXT
    return if (index == 0) today else addDaysToIsoDate(today, 7 - index)
}

/** A whole-number Double as an Int; null for NaN. */
private fun Double.toIntOrNull(): Int? = if (isNaN()) null else toInt()
