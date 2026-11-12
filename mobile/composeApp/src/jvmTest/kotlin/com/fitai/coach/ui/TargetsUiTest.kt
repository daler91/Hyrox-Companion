package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The nutrition targets end to end: the daily goals and one meal's pins, against the fake API. */
@OptIn(ExperimentalTestApi::class)
class TargetsUiTest {
    @Test
    fun dailyTargetsAreWorkedOutFromTheProfileAndScaledByTrainingLoad() {
        val api = FakeApi().apply {
            establishedAccount()
            on(
                "GET",
                "/api/v1/preferences",
                """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","gender":"male","age":30,""" +
                    """"bodyweightKg":70,"heightCm":175,"activityLevel":"moderate","weightGoalDirection":"maintain"}""",
            )
            on("GET", "/api/v1/nutrition/summary", emptyDay())
            on("GET", "/api/v1/nutrition/targets", """{"current":null,"history":[]}""")
            on("GET", "/api/v1/training-overview", overview(chronicAvg = 32))
            on("POST", "/api/v1/nutrition/targets", "{}", status = 201)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Set targets"))
            onNodeWithText("Set targets").performClick()

            awaitNode(hasText("Calculate from profile"))
            onNodeWithText("Calculate from profile").performClick()
            onNode(hasSetTextAction() and hasContentDescription("Calories (kcal)")).assert(hasText("2556"))
            onNode(hasSetTextAction() and hasContentDescription("Carbs (g)")).assert(hasText("355.4"))
            onNodeWithText(
                "BMR 1649 kcal (Mifflin–St Jeor), TDEE 2556 kcal (×1.55), goal +0 kcal → 2556 kcal. Protein 126g + fat 70g " +
                    "anchored to 70kg; carbs 355.4g fill the remainder.",
            ).assertExists()

            // Load scaling starts from the athlete's own typical load, and a first target adapts by default.
            onNodeWithText("Scale carbs by training load").performScrollTo().performClick()
            awaitNode(hasText("Adapt to recent & upcoming training"))
            onNodeWithText("Save targets").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/targets").isNotEmpty() }
            val body = api.sent("POST", "/api/v1/nutrition/targets").single().body.orEmpty()
            listOf(
                """"calories":2556.0""",
                """"proteinG":126.0""",
                """"periodizationEnabled":true""",
                """"referenceUtss":32.0""",
                """"carbGramsPerUtss":5.6""",
                """"recoveryEnabled":true""",
                """"phaseAware":true""",
            ).forEach { assertTrue(it in body, body) }
            awaitNode(hasText("Targets saved"))
        }
    }

    @Test
    fun aMealIsPinnedAndACustomOneIsReset() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", emptyDay(MEAL_TARGETS))
            on("POST", "/api/v1/nutrition/meal-targets", "{}", status = 201)
            on("DELETE", "/api/v1/nutrition/meal-targets/dinner", """{"success":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Set targets"))

            // A blank field follows the figure shown in it.
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasContentDescription("Adjust lunch target"))
            onNodeWithContentDescription("Adjust lunch target").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Pin this meal's goals", substring = true))
            // The carbs field is blank, its placeholder the split's 90 g.
            onNode(hasSetTextAction() and hasContentDescription("Carbs (g)")).assert(hasText(""))
            onNodeWithText("90").assertExists()
            onNode(hasSetTextAction() and hasContentDescription("Protein (g)")).performTextInput("50")
            onNodeWithText("Save").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/meal-targets").isNotEmpty() }
            assertEquals(
                """{"mealType":"lunch","calories":null,"proteinG":50.0,"carbG":null,"fatG":null}""",
                api.sent("POST", "/api/v1/nutrition/meal-targets").single().body,
            )

            // Dinner's three pinned macros set its calories; Reset drops the pins.
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasContentDescription("Adjust dinner target"))
            onNodeWithText("Custom").assertExists()
            onNodeWithContentDescription("Adjust dinner target").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Calories follow the three macros you pinned", substring = true))
            // Read-only: it can't be typed in, and says why.
            onNode(hasContentDescription("Calories (kcal), set by the three macros you pinned")).assert(hasText("825"))
            onNodeWithText("Reset to suggested").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("DELETE", "/api/v1/nutrition/meal-targets/dinner").isNotEmpty() }
        }
    }
}

/** Lunch follows the computed split; dinner carries three macro pins (and a stale calorie pin). */
private const val MEAL_TARGETS =
    """"mealTargets":{"lunch":{"calories":760,"proteinG":40,"carbG":90,"fatG":20,"role":"standard","reasonCodes":[],""" +
        """"rationale":""},"dinner":{"calories":825,"proteinG":50,"carbG":100,"fatG":25,"role":"standard",""" +
        """"reasonCodes":["user_override"],"rationale":"","override":{"calories":900,"proteinG":50,"carbG":100,"fatG":25},""" +
        """"suggested":{"calories":700,"proteinG":35,"carbG":90,"fatG":20}}}"""

/** Today's summary with nothing logged, and [extra] fields (JSON members) such as meal targets. */
private fun emptyDay(extra: String? = null) =
    """{"logDate":"${FakeApi.today}","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},"meals":{"breakfast":[],""" +
        """"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}${extra?.let { ",$it" }.orEmpty()}}"""

/** A training overview whose typical daily load (the chronic average) is [chronicAvg]. */
private fun overview(chronicAvg: Int) =
    """{"weeklySummaries":[],"workoutDates":[],"categoryTotals":{},"stationCoverage":[],"movementPatternCoverage":[],""" +
        """"muscleGroupCoverage":[],"currentStreak":0,"weeklyCompletedWorkouts":0,"weeklyGoal":4,"currentStats":{"totalWorkouts":0,""" +
        """"avgPerWeek":0,"totalDuration":0,"avgDuration":0,"totalRunningMeters":0},"trainingLoad":{"currentUtss":0,"acuteAvg":0,""" +
        """"chronicAvg":$chronicAvg,"zone":"insufficient_data","monotonyZone":"ok","hrZones":[],"powerTssEstimated":false,""" +
        """"flaggedVectors":[],"activeRestrictions":[],"trend":[]}}"""
