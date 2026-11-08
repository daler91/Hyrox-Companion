package com.fitai.coach.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The app end to end on the desktop JVM: the real screens, view models,
 * session and database, against a fake auth gateway and server.
 */
@OptIn(ExperimentalTestApi::class)
class AppUiTest {
    @Test
    fun signingInWithAnEmailCodeOpensTheTimeline() {
        val api = FakeApi().apply { establishedAccount() }
        appTest(FakeAuth(AuthState.SignedOut), api) { app ->
            onNodeWithContentDescription("email").performTextInput("athlete@example.com")
            onNodeWithText("email me a code").performClick()
            awaitNode(hasText("check your email"))
            assertEquals(listOf("athlete@example.com"), app.auth.codesSentTo.toList())

            onNodeWithContentDescription("code").performTextInput("123456")
            onNodeWithText("sign in").performClick()
            awaitNode(hasText("training"))
        }
    }

    @Test
    fun aNewAccountGetsSetupAndLeavingItMarksItDone() {
        val api = FakeApi().apply {
            privacyAcknowledged()
            preferences(onboarded = false)
            on("GET", "/api/v1/plans", "[]")
            on("GET", "/api/v1/timeline", "[]")
            on("PATCH", "/api/v1/preferences", """{"userTimezone":"UTC","onboardingCompleted":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("leave setup"))
            onNodeWithContentDescription("leave setup").performClick()
            onNodeWithText("Leave setup").performClick()

            // Back on the (empty) timeline, with setup recorded as done.
            awaitNode(hasText("Log a workout"))
            waitUntil(timeoutMillis = 10_000) {
                api.sent("PATCH", "/api/v1/preferences").any { it.body.orEmpty().contains("\"onboardingCompleted\":true") }
            }
        }
    }

    @Test
    fun completingTodaysSessionSendsTheWorkout() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("POST", "/api/v1/workouts", """{"id":"w1"}""", status = 201)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Tempo intervals"))
            onNodeWithText("Tempo intervals").performClick()
            awaitNode(hasText("Complete workout"))
            onNodeWithText("Complete workout").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/workouts").isNotEmpty() }
            assertTrue(api.sent("POST", "/api/v1/workouts").single().body.orEmpty().contains("\"planDayId\":\"d1\""))
        }
    }

    @Test
    fun switchingToPoundsInSettingsSavesThePreference() {
        val api = FakeApi().apply {
            establishedAccount()
            on("PATCH", "/api/v1/preferences", """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"lbs"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Settings"))
            onNodeWithContentDescription("Settings").performClick()
            awaitNode(hasText("lbs"))
            onNodeWithText("lbs").performClick()

            waitUntil(timeoutMillis = 10_000) {
                api.sent("PATCH", "/api/v1/preferences").any { it.body.orEmpty().contains("\"weightUnit\":\"lbs\"") }
            }
        }
    }

    @Test
    fun aLinkFromANotificationOpensItsScreen() {
        val api = FakeApi().apply { establishedAccount() }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))

            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("nutrition"))
        }
    }
}
