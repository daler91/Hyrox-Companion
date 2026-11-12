package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** What the day's log adds up to, end to end: energy balance, micronutrients and the AI's insights. */
@OptIn(ExperimentalTestApi::class)
class NutritionReportsUiTest {
    @Test
    fun aDayShowsItsEnergyBalanceAndMicrosAndInsightsAreGenerated() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/auth/user", """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"aiCoachEnabled":true}""")
            on("GET", "/api/v1/nutrition/summary", loggedDay(ENERGY))
            on("GET", "/api/v1/nutrition/micros", MICROS)
            on("GET", "/api/v1/nutrition/insights", """{"insights":null}""")
            on(
                "POST",
                "/api/v1/nutrition/insights",
                """{"insights":"Carbs ran short on **hard days**.","generatedAt":"2026-11-10T09:30:00.000Z","stale":false}""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())

            // In against out, labelled by how "out" was measured, with the working behind an info button.
            awaitNode(hasText("Energy balance"))
            onNodeWithText("Training burn from your logged workouts").assertExists()
            onNode(hasContentDescription("balance -716")).assertExists()
            onNodeWithContentDescription("How energy balance is worked out").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("BMR 1650 kcal", substring = true))

            // The day's micros against reference intakes, read out in full.
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasContentDescription("Iron", substring = true))
            onNode(hasContentDescription("Iron: 18 of 18 mg, 100% of daily intake")).assertExists()
            onNode(hasContentDescription("Vitamin D: 2.5 of 15 mcg, 17% of daily intake")).assertExists()
            assertTrue(api.sent("GET", "/api/v1/nutrition/micros").isNotEmpty())

            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Generate insights"))
            onNode(hasText("Generate insights") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Carbs ran short on", substring = true))
            assertEquals(1, api.sent("POST", "/api/v1/nutrition/insights").size)
        }
    }

    @Test
    fun withTheAiCoachOffInsightsSayWhereToTurnItOn() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/auth/user", """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"aiCoachEnabled":false}""")
            on("GET", "/api/v1/nutrition/summary", loggedDay(energy = null))
            on("GET", "/api/v1/nutrition/micros", """{"date":"${FakeApi.today}","micros":[]}""")
            on("GET", "/api/v1/nutrition/insights", """{"insights":null}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Oats"))
            // No profile to estimate from: no energy card. No micro data yet: the panel says why.
            onNodeWithText("Energy balance").assertDoesNotExist()
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("No micronutrient data yet", substring = true))

            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Enable AI Coach"))
            onNodeWithText("The AI Coach is turned off", substring = true).assertExists()
            onNode(hasText("Generate insights") and hasClickAction()).assertIsNotEnabled()
            onNodeWithText("Enable AI Coach").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("settings"))
            assertTrue(api.sent("POST", "/api/v1/nutrition/insights").isEmpty())
        }
    }
}

private const val ENERGY =
    """{"inKcal":304,"outKcal":1020,"balanceKcal":-716,"bmrKcal":1650,"activeKcal":420,"basis":"measured","reasonCodes":[],""" +
        """"explanation":"BMR 1650 kcal plus 420 kcal measured from your workouts."}"""

private val MICROS =
    """{"date":"${FakeApi.today}","micros":[{"key":"iron","label":"Iron","unit":"mg","amount":18,"rdi":18,"pctRdi":100},""" +
        """{"key":"vitamin_d","label":"Vitamin D","unit":"mcg","amount":2.5,"rdi":15,"pctRdi":17}]}"""

/** Today with oats at breakfast, and [energy] (a JSON object) when the profile supports an estimate. */
private fun loggedDay(energy: String?): String {
    val today = FakeApi.today
    val oats = """{"id":"e1","foodId":"f1","name":"Oats","loggedAt":"${today}T08:00:00Z","logDate":"$today","quantityG":80,""" +
        """"mealType":"breakfast","entryMethod":"manual","nutrition":{"calories":304,"protein":10,"carb":54,"fat":5,"fiber":8},""" +
        """"per100g":{"caloriesPer100g":380}}"""
    return """{"logDate":"$today","totals":{"calories":304,"protein":10,"carb":54,"fat":5,"fiber":8},"meals":{"breakfast":[$oats],""" +
        """"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}""" +
        (energy?.let { ""","energy":$it}""" } ?: "}")
}
