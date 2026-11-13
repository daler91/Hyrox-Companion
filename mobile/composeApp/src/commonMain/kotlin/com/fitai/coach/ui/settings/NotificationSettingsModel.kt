package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.api.generated.User
import com.fitai.coach.core.notifications.BRIEF_TOMORROW_FROM_HOUR
import com.fitai.coach.core.notifications.DEFAULT_NOTIFY_HOUR
import com.fitai.coach.core.notifications.EmailNotifyKind
import com.fitai.coach.core.notifications.NotifyHourPreferences
import com.fitai.coach.core.notifications.fallbackNotifyHour
import com.fitai.coach.core.notifications.resolveNotifyHour

/** The hours an email can be sent at, 00:00 to 23:00. */
val SEND_HOURS: List<Int> = (0..23).toList()

/**
 * One scheduled email in Settings (the web's EmailTypeRow): its switch, what
 * it is, and the send hour that email alone goes out at.
 */
enum class EmailType(val kind: EmailNotifyKind, val label: String) {
    WeeklySummary(EmailNotifyKind.WeeklySummary, "Weekly summary"),
    MissedReminder(EmailNotifyKind.MissedReminder, "Missed workout reminder"),
    WeeklyReviewReminder(EmailNotifyKind.WeeklyReviewReminder, "Weekly review reminder"),
    SessionBrief(EmailNotifyKind.TodaySession, "Session brief"),
    AnalysisDigest(EmailNotifyKind.AnalysisDigest, "Analysis digest"),
    ;

    fun isOn(prefs: PreferencesResponse): Boolean = when (this) {
        WeeklySummary -> prefs.emailWeeklySummary
        MissedReminder -> prefs.emailMissedReminder
        WeeklyReviewReminder -> prefs.emailWeeklyReviewReminder
        SessionBrief -> prefs.emailTodaySession
        AnalysisDigest -> prefs.emailAnalysisDigest
    } == true

    fun switchPatch(on: Boolean): UpdateUserPreferences = when (this) {
        WeeklySummary -> UpdateUserPreferences(emailWeeklySummary = on)
        MissedReminder -> UpdateUserPreferences(emailMissedReminder = on)
        WeeklyReviewReminder -> UpdateUserPreferences(emailWeeklyReviewReminder = on)
        SessionBrief -> UpdateUserPreferences(emailTodaySession = on)
        AnalysisDigest -> UpdateUserPreferences(emailAnalysisDigest = on)
    }

    /** What the email is; the session brief's depends on whether its send time briefs today or tomorrow. */
    fun description(prefs: PreferencesResponse): String = when (this) {
        WeeklySummary -> "Sent every Monday with your completion rate, streak, and total training time."
        MissedReminder -> "Sent the day after you miss a planned workout so you can catch up."
        WeeklyReviewReminder -> "Sent Sunday with the week so far and a link to write your review."
        SessionBrief -> if (resolveNotifyHour(notifyHours(prefs), kind) >= BRIEF_TOMORROW_FROM_HOUR) {
            "On training days, tomorrow's planned session — its send time is after midday."
        } else {
            "On training days, the day's planned session."
        }
        AnalysisDigest ->
            "Your race prediction and coach insights by email whenever a fresh analysis lands, at most about once a week."
    }

    /** This email's own send hour, or null while it follows the default. */
    fun override(prefs: PreferencesResponse): Int? = notifyHours(prefs).overrideFor(kind)?.toInt()

    /** Gives this email its own [hour], or (null) sends it at the default again. */
    fun hourPatch(hour: Int?): UpdateUserPreferences {
        val value: Patch<Int> = Patch.of(hour)
        return when (this) {
            WeeklySummary -> UpdateUserPreferences(notifyHourWeeklySummary = value)
            MissedReminder -> UpdateUserPreferences(notifyHourMissedReminder = value)
            WeeklyReviewReminder -> UpdateUserPreferences(notifyHourWeeklyReviewReminder = value)
            SessionBrief -> UpdateUserPreferences(notifyHourTodaySession = value)
            AnalysisDigest -> UpdateUserPreferences(notifyHourAnalysisDigest = value)
        }
    }

    /** "Default (07:00)": the option that follows the default send time, showing the hour that is. */
    fun defaultLabel(prefs: PreferencesResponse): String = "Default (${hourLabel(fallbackNotifyHour(kind, prefs.notifyHour))})"

    /** The send time as the picker shows it. */
    fun sendTimeLabel(prefs: PreferencesResponse): String = override(prefs)?.let(::hourLabel) ?: defaultLabel(prefs)
}

/** The athlete's default send time, 07:00 until they pick one. */
fun defaultSendHour(prefs: PreferencesResponse): Int = prefs.notifyHour ?: DEFAULT_NOTIFY_HOUR

private fun notifyHours(prefs: PreferencesResponse) = NotifyHourPreferences(
    notifyHour = prefs.notifyHour,
    notifyHourWeeklySummary = prefs.notifyHourWeeklySummary,
    notifyHourMissedReminder = prefs.notifyHourMissedReminder,
    notifyHourWeeklyReviewReminder = prefs.notifyHourWeeklyReviewReminder,
    notifyHourTodaySession = prefs.notifyHourTodaySession,
    notifyHourAnalysisDigest = prefs.notifyHourAnalysisDigest,
)

/**
 * The opt-in nutrition push reminders. They are stored on the user (GET
 * /preferences doesn't return them), so the switches read the signed-in user.
 */
enum class PushReminder(val label: String, val description: String) {
    Refuel("Post-workout refuel", "A nudge after a session while recovery carbs and protein are still owed."),
    Logging("Evening logging reminder", "An 8pm nudge on days where nothing has been logged yet."),
    ;

    fun isOn(user: User?): Boolean = when (this) {
        Refuel -> user?.pushRefuelReminder
        Logging -> user?.pushLoggingReminder
    } == true

    fun patch(on: Boolean): UpdateUserPreferences = when (this) {
        Refuel -> UpdateUserPreferences(pushRefuelReminder = on)
        Logging -> UpdateUserPreferences(pushLoggingReminder = on)
    }
}

/** What the test push did: sent somewhere, or reached no device at all. */
fun testPushMessage(sent: Long): String = if (sent > 0) {
    "Test notification sent"
} else {
    "The test didn't reach any device. Turn push notifications off and on, then try again."
}
