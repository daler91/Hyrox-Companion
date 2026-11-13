package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performSemanticsAction
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The coach's extras, end to end: the active style badge, and "Get workout
 * suggestions" giving cards that Apply writes into the plan.
 */
@OptIn(ExperimentalTestApi::class)
class CoachExtrasUiTest {
    @Test
    fun suggestionsAreAppliedFromTheCoachUnderTheActiveStyleBadge() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on(
                "GET",
                "/api/v1/preferences",
                """{"userTimezone":"UTC","onboardingCompleted":true,"aiCoachEnabled":true,"trainingStyleId":"maf_method"}""",
            )
            on(
                "GET",
                "/api/v1/chat/welcome",
                """{"greeting":"Morning! Tempo today.","quickActions":[{"id":"suggestions","label":"Get workout suggestions"}]}""",
            )
            on("GET", "/api/v1/chat/history", "[]")
            on("POST", "/api/v1/chat/message", """{"id":"m1","role":"user","content":"x"}""")
            on("POST", "/api/v1/timeline/ai-suggestions", """{"suggestions":[$SUGGESTION]}""")
            on("POST", "/api/v1/timeline/ai-suggestions/apply", """{"applied":true,"structured":false}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("open coach"))
            onNode(hasContentDescription("open coach")).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("ACTIVE STYLE: MAF METHOD"))

            tap("Get workout suggestions")
            awaitNode(hasText("Coaching suggestion"))
            awaitNode(hasText("Replace Main workout"))
            assertTrue(api.sent("POST", "/api/v1/chat/stream").isEmpty())

            tap("Apply")
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/timeline/ai-suggestions/apply").isNotEmpty() }
            awaitNode(hasText("Applied suggestion to Tempo intervals (${FakeApi.today}). The main workout has been updated."))
            val body = api.sent("POST", "/api/v1/timeline/ai-suggestions/apply").single().body.orEmpty()
            assertTrue(""""workoutId":"d1"""" in body && """"recommendation":"6 x 1 km at threshold"""" in body, body)
        }
    }
}

private val SUGGESTION =
    """{"workoutId":"d1","date":"${FakeApi.today}","focus":"Tempo intervals","targetField":"mainWorkout",""" +
        """"action":"replace","recommendation":"6 x 1 km at threshold","rationale":"Builds race pace","priority":"high"}"""

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.tap(label: String) {
    // A chip's or button's label merges into its clickable parent, so wait on the merged tree.
    val node = hasText(label) and hasClickAction()
    waitUntil(timeoutMillis = 10_000) { onAllNodes(node).fetchSemanticsNodes().isNotEmpty() }
    onNode(node).performSemanticsAction(SemanticsActions.OnClick)
}
