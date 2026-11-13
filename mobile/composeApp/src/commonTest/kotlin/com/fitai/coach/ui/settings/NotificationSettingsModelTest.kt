package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.api.generated.User
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NotificationSettingsModelTest {
    private fun prefs(json: String = "") = ApiJson.decodeFromString(
        PreferencesResponse.serializer(),
        """{"userTimezone":"UTC","onboardingCompleted":true${if (json.isEmpty()) "" else ",$json"}}""",
    )

    private fun UpdateUserPreferences.json() = ApiJson.encodeToString(UpdateUserPreferences.serializer(), this)

    @Test
    fun anEmailWithoutItsOwnHourFollowsTheDefaultExceptTheReviewReminder() {
        val unset = prefs()
        assertEquals("Default (07:00)", EmailType.WeeklySummary.sendTimeLabel(unset))

        val early = prefs(""""notifyHour":6,"notifyHourMissedReminder":18""")
        assertEquals("Default (06:00)", EmailType.WeeklySummary.sendTimeLabel(early))
        assertEquals("18:00", EmailType.MissedReminder.sendTimeLabel(early))
        // The review reminder falls back to Sunday evening, not the morning default.
        assertEquals("Default (17:00)", EmailType.WeeklyReviewReminder.sendTimeLabel(early))
        assertEquals(6, defaultSendHour(early))
    }

    @Test
    fun theSessionBriefSaysWhichDayItBriefsFromItsSendTime() {
        assertEquals("On training days, the day's planned session.", EmailType.SessionBrief.description(prefs()))
        assertEquals(
            "On training days, tomorrow's planned session — its send time is after midday.",
            EmailType.SessionBrief.description(prefs(""""notifyHour":13""")),
        )
        // Its own hour wins over the default.
        assertEquals(
            "On training days, the day's planned session.",
            EmailType.SessionBrief.description(prefs(""""notifyHour":13,"notifyHourTodaySession":6""")),
        )
    }

    @Test
    fun aSendHourIsSavedOnItsOwnFieldAndDefaultClearsIt() {
        assertEquals("""{"notifyHourTodaySession":18}""", EmailType.SessionBrief.hourPatch(18).json())
        assertEquals("""{"notifyHourWeeklySummary":null}""", EmailType.WeeklySummary.hourPatch(null).json())
        assertEquals("""{"emailAnalysisDigest":true}""", EmailType.AnalysisDigest.switchPatch(true).json())
        assertTrue(EmailType.SessionBrief.isOn(prefs(""""emailTodaySession":true""")))
        assertFalse(EmailType.SessionBrief.isOn(prefs()))
    }

    @Test
    fun theNutritionRemindersAreReadFromTheUser() {
        val user = ApiJson.decodeFromString(
            User.serializer(),
            """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"pushRefuelReminder":true}""",
        )
        assertTrue(PushReminder.Refuel.isOn(user))
        assertFalse(PushReminder.Logging.isOn(user))
        assertFalse(PushReminder.Refuel.isOn(null))
        assertEquals("""{"pushLoggingReminder":true}""", PushReminder.Logging.patch(true).json())

        assertEquals("Test notification sent", testPushMessage(1))
        assertTrue(testPushMessage(0).startsWith("The test didn't reach any device"))
    }
}
