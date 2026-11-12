package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Fuelling around sessions, end to end: a logged workout's windows, a planned session's targets, and each day's chip. */
@OptIn(ExperimentalTestApi::class)
class SessionFuellingUiTest {
    @Test
    fun aLoggedWorkoutShowsWhatWasEatenAroundItAndLogsTheRecoveryMeal() {
        val today = FakeApi.today
        val oats = """{"id":"f1","source":"usda","name":"Rolled oats","caloriesPer100g":380,"isPublic":true,""" +
            """"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
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
            on("GET", "/api/v1/nutrition/session-fuelling/w1", sessionFuelling(today))
            on("GET", "/api/v1/nutrition/summary", emptyDay(today))
            on("GET", "/api/v1/nutrition/foods/search", """{"results":[$oats],"apiDegraded":false}""")
            on("GET", "/api/v1/nutrition/foods/f1", """{"food":$oats,"servings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Leg day"))
            onAllNodesWithText("Leg day").onLast().performClick()
            awaitNode(hasText("Fuelling around this session"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Log recovery meal"))

            // Breakfast before the session met its carbs; nothing yet after it.
            onNodeWithText("Pre-session fuelling · 1 item").assertExists()
            onNode(hasContentDescription("Pre-session fuelling: 304 kcal, 10 g protein, 54 g carbs, 5 g fat")).assertExists()
            onNodeWithText("Aim ~30g carbs (on target)").assertExists()
            onNodeWithText("Nothing logged").assertExists()
            onNodeWithText("Aim ~60g carbs (60g to go) · ~25g protein (25g to go)").assertExists()
            onNodeWithText("Connect Strava or Garmin for exact session timing", substring = true).assertExists()
            onNodeWithContentDescription("How these targets are worked out").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("No bodyweight set", substring = true))

            // Recovery is still owed: the button opens the day's food search, logging to post-workout.
            onNodeWithText("Log recovery meal").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasSetTextAction() and hasContentDescription("Search foods"))
            assertTrue(api.sent("GET", "/api/v1/nutrition/summary").any { "date=$today" in it.query })
            onNode(hasSetTextAction() and hasContentDescription("Search foods")).performTextInput("oats")
            awaitNode(hasText("Rolled oats"))
            onNodeWithText("Rolled oats").performSemanticsAction(SemanticsActions.OnClick)
            // The meal chips merge their label into the chip that's selected.
            waitUntil(timeoutMillis = 10_000) { onAllNodes(hasText("Post-workout") and isSelected()).fetchSemanticsNodes().isNotEmpty() }
        }
    }

    @Test
    fun aPlannedSessionsFuelFollowsItsEstimateAndAdjustmentsSaveAsOne() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on(
                "GET",
                "/api/v1/preferences",
                """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","bodyweightKg":70}""",
            )
            on(
                "GET",
                "/api/v1/nutrition/planned-session-estimate/d1",
                """{"planDayId":"d1","durationMin":60,"rpe":8,"rationale":"Six 800s at threshold pace.",""" +
                    """"source":"structure","refined":true}""",
            )
            on("PATCH", "/api/v1/plans/days/d1", "{}")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Tempo intervals"))
            onAllNodesWithText("Tempo intervals").onLast().performClick()
            awaitNode(hasText("Fuel for this session"))

            // An hour at RPE 8 for a 70 kg athlete, from the server's estimate, which says why.
            awaitNode(hasText("Aim ~38g carbs"))
            onNodeWithText("Aim ~66g carbs · ~21g protein").assertExists()
            onNodeWithText("Estimated from your planned exercises — adjust below to fine-tune.").assertExists()
            onNodeWithContentDescription("Why this estimate").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Six 800s at threshold pace."))

            // Ten minutes longer and a little easier: one save, and the targets follow.
            onNode(hasText("Adjust session estimate · 60 min · RPE 8")).performSemanticsAction(SemanticsActions.OnClick)
            repeat(2) { onNodeWithContentDescription("Increase expected duration").performSemanticsAction(SemanticsActions.OnClick) }
            onAllNodes(hasText("6") and hasClickAction()).onFirst().performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Aim ~33g carbs"))
            onNodeWithText("Aim ~57g carbs · ~21g protein").assertExists()
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").isNotEmpty() }
            val saved = api.sent("PATCH", "/api/v1/plans/days/d1").single().body.orEmpty()
            assertTrue(""""expectedDurationMin":70""" in saved, saved)
            assertTrue(""""expectedRpe":6""" in saved, saved)

            // A start time saves once it reads as one.
            onNode(hasSetTextAction() and hasContentDescription("Session time")).performTextInput("06:45")
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").size == 2 }
            assertEquals("""{"plannedTimeOfDayMin":405}""", api.sent("PATCH", "/api/v1/plans/days/d1").last().body)
        }
    }

    @Test
    fun aDaysFuellingChipReadsItsIntakeAndOpensTheDayInNutrition() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("GET", "/api/v1/nutrition/summary-range", fuellingRange(today))
            on("GET", "/api/v1/nutrition/summary", emptyDay(today))
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            val chip = hasContentDescription("Fuelling: 1840 of 2400 kcal, 120 of 150 g protein, post-workout meal logged")
            awaitNode(chip)
            val asked = api.sent("GET", "/api/v1/nutrition/summary-range").first().query
            assertTrue("from=" in asked && "to=" in asked, asked)

            onNode(chip).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Set targets"))
            assertTrue(api.sent("GET", "/api/v1/nutrition/summary").any { "date=$today" in it.query })
        }
    }
}

private fun emptyDay(day: String) =
    """{"logDate":"$day","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},"meals":{"breakfast":[],""" +
        """"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

/** Oats before the session, nothing after it, timed by meal tags; no bodyweight, so general targets. */
private fun sessionFuelling(day: String): String {
    val oats = """{"id":"e1","foodId":"f1","name":"Oats","loggedAt":"${day}T08:00:00Z","logDate":"$day","quantityG":80,""" +
        """"mealType":"pre_workout","entryMethod":"manual","nutrition":{"calories":304,"protein":10,"carb":54,"fat":5,"fiber":8},""" +
        """"per100g":{"caloriesPer100g":380}}"""
    return """{"workoutId":"w1","date":"$day","usedStartTime":false,"pre":[$oats],"post":[],""" +
        """"preTotals":{"calories":304,"protein":10,"carb":54,"fat":5,"fiber":8},""" +
        """"postTotals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
        """"target":{"preCarbG":30,"postCarbG":60,"postProteinG":25,"reasonCodes":["no_bodyweight_defaults"],""" +
        """"explanation":"No bodyweight set — showing general defaults. Guidance only."},""" +
        """"gap":{"preCarbG":-24,"postCarbG":60,"postProteinG":25}}"""
}

private fun fuellingRange(day: String) =
    """{"from":"$day","to":"$day","days":[{"date":"$day","totals":{"calories":1840,"protein":120,"carb":200,"fat":60,"fiber":20},""" +
        """"effectiveTarget":{"calories":2400,"proteinG":150,"carbG":300,"fatG":80,"carbDeltaG":0,"baseLoadDeltaG":0,""" +
        """"recoveryDeltaG":0,"preloadDeltaG":0,"proteinDeltaG":0,"utss":0,"scaled":false,"reasonCodes":[],"explanation":""},""" +
        """"hasPostWorkoutFuel":true}]}"""
