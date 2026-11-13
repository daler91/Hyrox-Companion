package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Settings → notifications, end to end: an email that is on gets its own send
 * time (or the default again), and with push on this phone the nutrition
 * reminders save and a test notification goes out.
 */
@OptIn(ExperimentalTestApi::class)
class NotificationSettingsUiTest {
    @Test
    fun anEmailThatIsOnGetsItsOwnSendTime() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/preferences", PREFS)
            on("PATCH", "/api/v1/preferences", PREFS.replace("}", ""","notifyHourTodaySession":18}"""))
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600) {
            openSettings()
            val picker = hasContentDescription("Session brief send time, Default (07:00)") and hasClickAction()
            scrollTo(picker)
            // An email that is off has no send time to pick.
            assertTrue(onAllNodes(hasContentDescription("Weekly summary send time", substring = true)).fetchSemanticsNodes().isEmpty())

            tap(picker)
            tap(hasText("18:00") and hasClickAction())
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/preferences").isNotEmpty() }
            assertEquals("""{"notifyHourTodaySession":18}""", api.sent("PATCH", "/api/v1/preferences").single().body)
            // Briefed after midday, the session brief covers tomorrow.
            awaitNode(hasText("tomorrow's planned session", substring = true))
        }
    }

    @Test
    fun withPushOnTheRemindersSaveAndATestNotificationGoesOut() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/preferences", PREFS)
            on("GET", "/api/v1/auth/user", """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"pushRefuelReminder":false}""")
            on("PATCH", "/api/v1/preferences", PREFS)
            on("POST", "/api/v1/push/devices", """{"success":true}""")
            on("POST", "/api/v1/push/test", """{"success":true,"sent":1}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600, pushOnFor = "u1") {
            openSettings()
            val refuel = hasText("Post-workout refuel") and hasClickAction()
            scrollTo(refuel)
            tap(refuel)
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/preferences").isNotEmpty() }
            assertEquals("""{"pushRefuelReminder":true}""", api.sent("PATCH", "/api/v1/preferences").single().body)

            val test = hasContentDescription("Send a test notification") and hasClickAction()
            scrollTo(test)
            tap(test)
            awaitNode(hasText("Test notification sent"))
            assertEquals(1, api.sent("POST", "/api/v1/push/test").size)
        }
    }
}

private const val PREFS =
    """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","emailNotifications":true,""" +
        """"emailTodaySession":true,"notifyHour":7}"""

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openSettings() {
    awaitNode(hasContentDescription("Settings"))
    onNode(hasContentDescription("Settings")).performSemanticsAction(SemanticsActions.OnClick)
    awaitNode(hasText("Email notifications"))
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.scrollTo(matcher: SemanticsMatcher) {
    waitUntil(timeoutMillis = 10_000) { onAllNodes(hasScrollAction()).fetchSemanticsNodes().isNotEmpty() }
    waitUntil(timeoutMillis = 10_000) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
    onAllNodes(hasScrollAction()).onFirst().performScrollToNode(matcher)
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.tap(matcher: SemanticsMatcher) {
    waitUntil(timeoutMillis = 10_000) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
    onNode(matcher).performSemanticsAction(SemanticsActions.OnClick)
}
