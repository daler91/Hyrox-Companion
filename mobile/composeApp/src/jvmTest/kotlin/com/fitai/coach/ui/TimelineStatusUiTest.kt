package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performSemanticsAction
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.timeline.mafCeilingExplanation
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertTrue

private const val PLAN = """{"id":"p1","userId":"u1","name":"8-Week Hyrox Template","totalWeeks":8,"generationStatus":"ready"}"""

private val plannedRun =
    """{"id":"plan-d1","date":"${FakeApi.today}","type":"planned","status":"planned","focus":"Easy run","mainWorkout":"45 min easy",""" +
        """"planDayId":"d1","notes":"Felt tight yesterday\n[AI Coach] Pacing: hold 5:30/km",""" +
        """"coachNotes":{"athleteText":"Felt tight yesterday","cues":[{"label":"Pacing","text":"hold 5:30/km"}]},""" +
        """"exerciseSets":[{"id":"s1","planDayId":"d1","exerciseName":"easy_run","category":"running","setNumber":1,"version":1}]}"""

private fun loggedDaysAgo(days: Long): String {
    val date = LocalDate.now(ZoneOffset.UTC).minusDays(days)
    return """{"id":"log-w$days","date":"$date","type":"logged","status":"completed","focus":"Run $days",""" +
        """"mainWorkout":"5 km easy\nThen 4 x 400 m\nThen strides","workoutLogId":"w$days"}"""
}

private val loggedToday =
    """{"id":"log-w0","date":"${FakeApi.today}","type":"logged","status":"completed","focus":"Morning Run",""" +
        """"mainWorkout":"5 km easy\nThen 4 x 400 m\nThen strides","workoutLogId":"w0"}"""

/** The timeline's coach cues, MAF ceiling, offline and pending-sync marks, empty states, and the way back to today. */
@OptIn(ExperimentalTestApi::class)
class TimelineStatusUiTest {
    @Test
    fun aPlannedRunShowsTheCoachsCuesAndTheMafCeiling() {
        val api = FakeApi().apply {
            establishedAccount(plannedRun)
            on(
                "GET",
                "/api/v1/preferences",
                """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km",""" +
                    """"trainingStyleId":"maf_method","mafHr":142}""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Coach cues"))
            awaitNode(hasText("Felt tight yesterday"))
            awaitNode(hasText("Pacing: hold 5:30/km"))
            awaitNode(hasContentDescription(mafCeilingExplanation(142)))
        }
    }

    @Test
    fun offlineAChangeWaitsMarkedPendingAndGoesOnReconnecting() {
        val api = FakeApi().apply { establishedAccount(FakeApi.plannedToday("Tempo intervals")) }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("Tempo intervals"))
            app.network.value = false
            awaitNode(hasText("You're offline"))

            onNodeWithContentDescription("Mark Tempo intervals as complete").performClick()
            awaitNode(hasText("Pending sync"))
            awaitNode(hasText("1 change will sync when you reconnect"))
            assertTrue(api.sent("POST", "/api/v1/workouts").isEmpty())

            api.on(
                "POST",
                "/api/v1/workouts",
                """{"id":"w1","userId":"u1","date":"${FakeApi.today}","focus":"Tempo intervals","mainWorkout":"6 x 800 m",""" +
                    """"countsAsTraining":true,"autoLinkRecordingOnly":false,"deviceActivity":{}}""",
                status = 201,
            )
            app.network.value = true
            awaitNode(hasText("Back online — 1 change synced"))
            waitUntil(timeoutMillis = 10_000) {
                onAllNodes(hasText("Pending sync"), useUnmergedTree = true).fetchSemanticsNodes().isEmpty()
            }
        }
    }

    @Test
    fun theTemplatePlanIsCreatedAndAsksForItsStartDate() {
        val api = FakeApi().apply {
            privacyAcknowledged()
            preferences(onboarded = true)
            on("GET", "/api/v1/timeline", "[]")
            on("GET", "/api/v1/plans", "[]")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Welcome to fitai.coach"))
            api.on("POST", "/api/v1/plans/sample", PLAN.dropLast(1) + ""","days":[]}""")
            api.on("GET", "/api/v1/plans", "[$PLAN]")
            api.on("POST", "/api/v1/plans/p1/schedule", """{"success":true}""")

            onNode(hasText("Use 8-week template") and hasClickAction()).performClick()
            awaitNode(hasText("Schedule your training plan"))
            onNode(hasText("Schedule plan") and hasClickAction()).performClick()

            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/plans/p1/schedule").isNotEmpty() }
        }
    }

    @Test
    fun aPlanWithNothingOnTheCalendarOffersItsStartDate() {
        val api = FakeApi().apply { establishedAccount() }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Ready to start training"))
            // Pressed by its action, not a point on screen: from Sunday evening to Tuesday the weekly review
            // prompt sits above this card and pushes the button below the fold of the test's window.
            onNode(hasText("Set start date") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Schedule your training plan"))
        }
    }

    @Test
    fun onAFirstOpenTheTimelineScrollsToTodayOnceItHasLoaded() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"), loggedToday)
            on(
                "GET",
                "/api/v1/timeline-annotations",
                """[{"id":"a1","userId":"u1","startDate":"${FakeApi.today}","endDate":"${FakeApi.today}","type":"travel","note":"Away"}]""",
            )
            // Nothing cached and a slow server: today's row shows, empty, before the plans and the week above it.
            slow("GET", "/api/v1/timeline", millis = 1_000)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Away"))
            waitForIdle()
            onNodeWithContentDescription("Mark Tempo intervals as complete").assertIsDisplayed()
            onNodeWithContentDescription("Move Morning Run to another day").assertIsDisplayed()
        }
    }

    @Test
    fun scrolledAwayThePillTakesYouBackToToday() {
        val api = FakeApi().apply { establishedAccount(*(7L downTo 1L).map(::loggedDaysAgo).toTypedArray()) }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Run 1"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToIndex(0)
            awaitNode(hasContentDescription("Today is below — jump to today"))

            onNodeWithContentDescription("Today is below — jump to today").performClick()
            waitUntil(timeoutMillis = 10_000) {
                onAllNodes(hasContentDescription("Today is below — jump to today")).fetchSemanticsNodes().isEmpty()
            }
        }
    }
}
