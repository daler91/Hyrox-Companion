package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertTrue

private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

private fun daysAgo(days: Long): String = LocalDate.now(ZoneOffset.UTC).minusDays(days).toString()

private fun historyRow(id: String, role: String, content: String, at: ZonedDateTime) =
    """{"id":"$id","userId":"u1","role":"$role","content":"$content","timestamp":"${at.toInstant()}","kind":"text"}"""

/** Setup's fuelling step and its "Connect a device" close; the coach's stats bar, day headings and message times. */
@OptIn(ExperimentalTestApi::class)
class OnboardingCoachUiTest {
    @Test
    fun setupSuggestsTargetsFromTheBodyProfileAndClosesOfferingADevice() {
        val api = FakeApi().apply {
            privacyAcknowledged()
            preferences(onboarded = false)
            on("GET", "/api/v1/plans", "[]")
            on("GET", "/api/v1/timeline", "[]")
            on("GET", "/api/v1/nutrition/targets", """{"current":null,"history":[]}""")
            on("POST", "/api/v1/nutrition/targets", "{}", status = 201)
            on("PATCH", "/api/v1/preferences", """{"userTimezone":"UTC","onboardingCompleted":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Welcome to fitai.coach"))
            tap("Continue")
            awaitNode(hasText("Set your preferences"))
            tap("Continue")
            awaitNode(hasText("What's your goal?"))
            tap("Continue")

            awaitNode(hasText("Fuel your training"))
            awaitNode(hasText("Step 4 of 6"))
            onNodeWithContentDescription("Weight (kg)").performTextInput("80")
            onNodeWithContentDescription("Age").performTextInput("34")
            onNodeWithContentDescription("Height (cm)").performTextInput("180")
            tap("Moderately active — 3–4 sessions a week")
            awaitNode(hasText("Suggested daily targets: 2599 kcal · 144 g protein · 325.8 g carbs · 80 g fat"))
            tap("Continue")

            awaitNode(hasText("Meet your AI Coach"))
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/targets").isNotEmpty() }
            val profile = api.sent("PATCH", "/api/v1/preferences").first().body.orEmpty()
            assertTrue(
                """"bodyweightKg":80""" in profile && """"heightCm":180""" in profile && """"activityLevel":"moderate"""" in profile,
                profile,
            )
            assertTrue(""""calories":2599""" in api.sent("POST", "/api/v1/nutrition/targets").single().body.orEmpty())

            tap("Continue")
            awaitNode(hasText("Choose your path"))
            tap("Skip for now — I'll log workouts manually")
            awaitNode(hasText("Setup finished without a plan. Add one anytime from Plan tools, or run setup again from Settings."))
            tap("Connect a device")
            awaitNode(hasText("Garmin"))
        }
    }

    @Test
    fun theCoachShowsTheTimelinesNumbersAndWhenEachMessageWasSent() {
        val zone = ZoneId.systemDefault()
        val yesterday = ZonedDateTime.now(zone).minusDays(1).withHour(12).withMinute(0).withSecond(0).withNano(0)
        val justNow = ZonedDateTime.now(zone).withSecond(0).withNano(0)
        val api = FakeApi().apply {
            establishedAccount(
                """{"id":"log-w3","date":"${daysAgo(
                    3,
                )}","type":"logged","status":"completed","focus":"Run","mainWorkout":"","workoutLogId":"w3"}""",
                """{"id":"plan-d2","date":"${daysAgo(
                    2,
                )}","type":"planned","status":"missed","focus":"Intervals","mainWorkout":"","planDayId":"d2"}""",
                FakeApi.plannedToday("Tempo intervals"),
            )
            on("GET", "/api/v1/preferences", """{"userTimezone":"UTC","onboardingCompleted":true,"aiCoachEnabled":true}""")
            on("GET", "/api/v1/chat/welcome", """{"greeting":"Morning!","quickActions":[]}""")
            on(
                "GET",
                "/api/v1/chat/history",
                listOf(
                    historyRow("h1", "user", "How was my week?", yesterday),
                    historyRow("h2", "assistant", "Solid week.", yesterday.plusMinutes(1)),
                    historyRow("h3", "user", "And today?", justNow),
                ).joinToString(",", "[", "]"),
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Tempo intervals"))
            awaitNode(hasContentDescription("open coach"))
            onNode(hasContentDescription("open coach")).performSemanticsAction(SemanticsActions.OnClick)

            awaitNode(hasContentDescription("1 upcoming planned on your timeline"))
            awaitNode(hasContentDescription("50% completion rate over the last 4 weeks on your timeline"))
            // The day heading merges its label, so look in the merged tree.
            waitUntil(timeoutMillis = 10_000) { onAllNodes(hasText("Yesterday") and isHeading).fetchSemanticsNodes().isNotEmpty() }
            awaitNode(hasContentDescription("sent ${TIME.format(yesterday)}"))
            awaitNode(hasContentDescription("sent ${TIME.format(yesterday.plusMinutes(1))}"))
            awaitNode(hasContentDescription("sent ${TIME.format(justNow)}"))
        }
    }
}

private val isHeading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.tap(label: String) {
    // A button's label merges into its clickable parent, so wait on the merged tree.
    val node = hasText(label) and hasClickAction()
    waitUntil(timeoutMillis = 10_000) { onAllNodes(node).fetchSemanticsNodes().isNotEmpty() }
    onNode(node).performSemanticsAction(SemanticsActions.OnClick)
}
