package com.fitai.coach.ui

import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import java.time.LocalDate
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
            openCard("Tempo intervals")
            awaitNode(hasText("Complete workout"))
            onNodeWithText("Complete workout").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/workouts").isNotEmpty() }
            assertTrue(api.sent("POST", "/api/v1/workouts").single().body.orEmpty().contains("\"planDayId\":\"d1\""))
        }
    }

    @Test
    fun aDeletedWorkoutComesBackWithUndo() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount(
                """{"id":"log-w1","date":"$today","type":"logged","status":"completed",""" +
                    """"focus":"Leg day","mainWorkout":"","workoutLogId":"w1"}""",
            )
            on(
                "GET",
                "/api/v1/workouts/w1",
                """{"id":"w1","userId":"u1","date":"$today","focus":"Leg day","mainWorkout":"","countsAsTraining":true,""" +
                    """"autoLinkRecordingOnly":false,"deviceActivity":{},"exerciseSets":[],"structureBlocks":[]}""",
            )
            on("DELETE", "/api/v1/workouts/w1", """{"success":true,"recycleBinItemId":"rb1"}""")
            on("POST", "/api/v1/recycle-bin/rb1/restore", """{"ok":true,"entityType":"workout_log","entityId":"w1","warnings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Leg day"))
            openCard("Leg day")
            awaitNode(hasText("Delete workout"))
            onNodeWithText("Delete workout").performClick()
            onNodeWithText("Delete").performClick()

            // Back on the timeline, with the chance to take it back.
            awaitNode(hasText("Undo"))
            assertEquals(1, api.sent("DELETE", "/api/v1/workouts/w1").size)
            onNodeWithText("Undo").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/recycle-bin/rb1/restore").isNotEmpty() }
        }
    }

    @Test
    fun aSessionMovesFromItsCardMenu() {
        val tomorrow = LocalDate.parse(FakeApi.today).plusDays(1).toString()
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("PATCH", "/api/v1/plans/days/d1", "{}")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Move Tempo intervals to another day"))
            onNodeWithContentDescription("Move Tempo intervals to another day").performClick()
            onNodeWithText("Move to tomorrow").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").isNotEmpty() }
            assertTrue(api.sent("PATCH", "/api/v1/plans/days/d1").single().body.orEmpty().contains("\"scheduledDate\":\"$tomorrow\""))
        }
    }

    @Test
    fun aSkippedDayIsDeletedFromThePlanAndCanComeBack() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Long run").replace("\"status\":\"planned\"", "\"status\":\"skipped\""))
            on("DELETE", "/api/v1/plans/days/d1", """{"success":true,"recycleBinItemId":"rb1"}""")
            on("POST", "/api/v1/recycle-bin/rb1/restore", """{"ok":true,"entityType":"plan_day","entityId":"d1","warnings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            // The filter narrows to skipped sessions, and says when none match.
            awaitNode(hasText("Completed"))
            onNodeWithText("Completed").performClick()
            awaitNode(hasText("No completed workouts."))
            onNodeWithText("Skipped").performClick()

            openCard("Long run")
            onNodeWithText("Delete from plan").performClick()
            onNodeWithText("Delete").performClick()

            awaitNode(hasText("Undo"))
            assertEquals(1, api.sent("DELETE", "/api/v1/plans/days/d1").size)
            onNodeWithText("Undo").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/recycle-bin/rb1/restore").isNotEmpty() }
        }
    }

    @Test
    fun aPlannedSessionIsEditedOnItsOwnScreen() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on(
                "GET",
                "/api/v1/plans/days/d1/sets",
                """[{"id":"s1","planDayId":"d1","exerciseName":"back_squat","category":"strength","setNumber":1,"reps":5,"version":1}]""",
            )
            on("PATCH", "/api/v1/plans/days/d1", "{}")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Tempo intervals"))
            openCard("Tempo intervals")
            onNodeWithText("Edit session").performClick()

            awaitNode(hasText("Back Squat"))
            onNodeWithContentDescription("Title").performTextReplacement("Track intervals")
            onNodeWithText("Save").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").isNotEmpty() }
            assertTrue(api.sent("PATCH", "/api/v1/plans/days/d1").single().body.orEmpty().contains("\"focus\":\"Track intervals\""))
        }
    }

    @Test
    fun theLastWorkoutCanBeLoggedAgain() {
        val api = FakeApi().apply {
            establishedAccount()
            on(
                "GET",
                "/api/v1/workouts/latest",
                """{"id":"w1","userId":"u1","date":"2026-11-01","focus":"Leg day","mainWorkout":"Squats","countsAsTraining":true,""" +
                    """"autoLinkRecordingOnly":false,"deviceActivity":null,"structureBlocks":[],"exerciseSets":[""" +
                    """{"id":"s1","exerciseName":"back_squat","category":"strength","setNumber":1,"reps":5,"weight":100,"version":1}]}""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Log Workout"))
            onNodeWithContentDescription("Log Workout").performClick()
            awaitNode(hasText("Duplicate last workout"))
            onNodeWithText("Duplicate last workout").performClick()

            awaitNode(hasText("Back Squat"))
            onNodeWithText("Confirm exercises").assertExists()
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

    @Test
    fun aTrainingNoteShowsOnItsDayAndAStravaImportLinksToTheSuggestedSession() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount(
                FakeApi.plannedToday("Easy Run"),
                """{"id":"log-w9","date":"$today","type":"logged","status":"completed","focus":"Morning Run","mainWorkout":"",""" +
                    """"workoutLogId":"w9","source":"strava","stravaActivityId":"123","suggestedPlanDayId":"d1"}""",
            )
            on(
                "GET",
                "/api/v1/timeline-annotations",
                """[{"id":"a1","userId":"u1","startDate":"$today","endDate":"$today","type":"injury","note":"Calf strain"}]""",
            )
            on("POST", "/api/v1/workouts/w9/device-link", """{"id":"w9"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Calf strain"))
            awaitNode(hasText("Was this your Easy Run?"))
            onNodeWithText("Link").performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/workouts/w9/device-link").isNotEmpty() }
            assertEquals("""{"planDayId":"d1"}""", api.sent("POST", "/api/v1/workouts/w9/device-link").single().body)
        }
    }

    @Test
    fun theCoachReviewingBannerShowsUntilTheReviewEnds() {
        val reviewing = """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"isAutoCoaching":true}"""
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("GET", "/api/v1/auth/user", reviewing)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Coach is reviewing your workout"))

            api.on("GET", "/api/v1/auth/user", reviewing.replace("\"isAutoCoaching\":true", "\"isAutoCoaching\":false"))
            waitUntil(timeoutMillis = 10_000) { onAllNodesWithText("Coach is reviewing your workout").fetchSemanticsNodes().isEmpty() }
        }
    }
}

/**
 * Taps today's session on the timeline. The "This week" card above names it
 * too, so the timeline's card is the last of the two.
 */
@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openCard(focus: String) = onAllNodesWithText(focus).onLast().performClick()
