package com.fitai.coach.core.notifications

import kotlin.math.floor

/*
 * Per-email send hours, ported from shared/notifyHours.ts: the Settings copy
 * changes as the athlete picks an hour, and it must agree with the server's
 * email scheduler about when each email goes out. Pinned by the
 * `notifyHours.*` golden fixtures; see docs/mobile-shared-logic.md.
 *
 * Each email kind has a nullable override; null means "no override" and falls
 * back to the athlete's default send time (`notifyHour`), except the weekly
 * review reminder, which falls back to Sunday evening.
 */

/** `DEFAULT_NOTIFY_HOUR`: the local hour emails go out when the athlete has not picked one. */
public const val DEFAULT_NOTIFY_HOUR: Int = 7

/**
 * `BRIEF_TOMORROW_FROM_HOUR`: from this session-brief hour on, the brief
 * covers tomorrow's session instead of today's. "Briefs tomorrow" is
 * `resolveNotifyHour(prefs, EmailNotifyKind.TodaySession) >= BRIEF_TOMORROW_FROM_HOUR`.
 */
public const val BRIEF_TOMORROW_FROM_HOUR: Int = 12

/**
 * `WEEKLY_REVIEW_SUNDAY_EVENING_HOUR` (shared/weeklyReview.ts): the local hour
 * on Sunday the weekly review reminder falls back to.
 */
public const val WEEKLY_REVIEW_SUNDAY_EVENING_HOUR: Int = 17

/**
 * `EmailNotifyKind`: a scheduled email, with its API name ([wireValue]) and the
 * preferences field holding its send-hour override ([notifyHourField], TS:
 * `NOTIFY_HOUR_FIELD[kind]`).
 */
public enum class EmailNotifyKind(public val wireValue: String, public val notifyHourField: String) {
    WeeklySummary("weeklySummary", "notifyHourWeeklySummary"),
    MissedReminder("missedReminder", "notifyHourMissedReminder"),
    WeeklyReviewReminder("weeklyReviewReminder", "notifyHourWeeklyReviewReminder"),
    TodaySession("todaySession", "notifyHourTodaySession"),
    AnalysisDigest("analysisDigest", "notifyHourAnalysisDigest"),
    ;

    public companion object {
        /** The kind whose [wireValue] is [value], or null. */
        public fun fromWireValue(value: String): EmailNotifyKind? = entries.firstOrNull { it.wireValue == value }
    }
}

/** `EMAIL_NOTIFY_KINDS`: every email kind, in the TypeScript's order. */
public val EMAIL_NOTIFY_KINDS: List<EmailNotifyKind> = EmailNotifyKind.entries

/** `NOTIFY_HOUR_FIELD`: the send-hour override field behind each email kind. */
public val NOTIFY_HOUR_FIELD: Map<EmailNotifyKind, String> = EmailNotifyKind.entries.associateWith { it.notifyHourField }

/**
 * `NotifyHourPreferences`: the send-hour fields as a reader sees them, the
 * default plus every override. They are `Number?` because the TypeScript
 * accepts any number and ignores one that is not a whole hour from 0 to 23;
 * the `Int?` fields of the generated `PreferencesResponse` and `User` models
 * pass straight in.
 */
public data class NotifyHourPreferences(
    val notifyHour: Number? = null,
    val notifyHourWeeklySummary: Number? = null,
    val notifyHourMissedReminder: Number? = null,
    val notifyHourWeeklyReviewReminder: Number? = null,
    val notifyHourTodaySession: Number? = null,
    val notifyHourAnalysisDigest: Number? = null,
) {
    /** The override field for [kind] (TS: `prefs[NOTIFY_HOUR_FIELD[kind]]`). */
    public fun overrideFor(kind: EmailNotifyKind): Number? = when (kind) {
        EmailNotifyKind.WeeklySummary -> notifyHourWeeklySummary
        EmailNotifyKind.MissedReminder -> notifyHourMissedReminder
        EmailNotifyKind.WeeklyReviewReminder -> notifyHourWeeklyReviewReminder
        EmailNotifyKind.TodaySession -> notifyHourTodaySession
        EmailNotifyKind.AnalysisDigest -> notifyHourAnalysisDigest
    }
}

/**
 * `isValidNotifyHour`: true for an hour of the day the schedule can fire on,
 * a number that is a whole hour from 0 to 23. Anything else, a string "7"
 * included, is false, as for the TypeScript's `unknown` argument.
 */
public fun isValidNotifyHour(hour: Any?): Boolean = validHourOrNull(hour) != null

/**
 * `fallbackNotifyHour`: the hour [kind] goes out at when it has no override:
 * the athlete's default [notifyHour] when that is valid, else
 * [DEFAULT_NOTIFY_HOUR], and always [WEEKLY_REVIEW_SUNDAY_EVENING_HOUR] for the
 * weekly review reminder.
 */
public fun fallbackNotifyHour(kind: EmailNotifyKind, notifyHour: Number? = null): Int {
    if (kind == EmailNotifyKind.WeeklyReviewReminder) return WEEKLY_REVIEW_SUNDAY_EVENING_HOUR
    return validHourOrNull(notifyHour) ?: DEFAULT_NOTIFY_HOUR
}

/** `resolveNotifyHour`: the local hour [kind] goes out at: its own valid override, else [fallbackNotifyHour]. */
public fun resolveNotifyHour(prefs: NotifyHourPreferences, kind: EmailNotifyKind): Int =
    validHourOrNull(prefs.overrideFor(kind)) ?: fallbackNotifyHour(kind, prefs.notifyHour)

/** The hour as an Int when it is a valid one (`typeof hour === "number"`, an integer, 0..23), else null. */
private fun validHourOrNull(hour: Any?): Int? {
    if (hour !is Number) return null
    val value = hour.toDouble()
    val isInteger = value.isFinite() && floor(value) == value
    return if (isInteger && value >= 0.0 && value <= 23.0) value.toInt() else null
}
