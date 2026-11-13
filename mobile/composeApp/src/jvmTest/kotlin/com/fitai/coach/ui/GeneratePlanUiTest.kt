package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * A new AI plan from the timeline, end to end: the plan it runs over is
 * archived by default, the older injuries note and the athlete card come in,
 * and the AI Coach consent comes first when it is off.
 */
@OptIn(ExperimentalTestApi::class)
class GeneratePlanUiTest {
    @Test
    fun aNewPlanArchivesTheOneItRunsOverAndCarriesTheOlderNote() {
        val api = FakeApi().apply {
            accountWithLivePlan(aiCoachOn = true)
            on(
                "GET",
                "/api/v1/auth/user",
                """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,"trainingConstraints":"Sore left knee"}""",
            )
            on("GET", "/api/v1/athlete-facts", "[${fact("No box jumps", active = true)},${fact("Old ankle sprain", active = false)}]")
            on("POST", "/api/v1/plans/generate", """{"id":"p2"}""", status = 202)
            on("GET", "/api/v1/plans/p2/generation-status", """{"planId":"p2","generationStatus":"ready"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            click("New AI plan")
            awaitNode(hasText("You're already on a plan"))
            awaitNode(hasText("• No box jumps"))
            assertTrue(onAllNodes(hasText("• Old ankle sprain"), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
            awaitNode(hasText("Sore left knee"))

            onNode(hasSetTextAction() and hasContentDescription("Goal")).performTextInput("Sub-90 Hyrox Open in May")
            click("Generate plan")
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/plans/generate").isNotEmpty() }
            val body = api.sent("POST", "/api/v1/plans/generate").single().body.orEmpty()
            assertTrue(""""goal":"Sub-90 Hyrox Open in May"""" in body, body)
            assertTrue(""""supersedePlanIds":["p1"]""" in body, body)
            assertTrue(""""injuries":"Sore left knee"""" in body, body)

            awaitNode(hasText("Training plan generated. It's on your timeline."))
        }
    }

    @Test
    fun withTheAiCoachOffConsentComesFirstAndAKeptPlanIsLeftAlone() {
        val api = FakeApi().apply {
            accountWithLivePlan(aiCoachOn = false)
            on("PATCH", "/api/v1/preferences", """{"userTimezone":"UTC","onboardingCompleted":true,"aiCoachEnabled":true}""")
            on("POST", "/api/v1/plans/generate", """{"id":"p2"}""", status = 202)
            on(
                "GET",
                "/api/v1/plans/p2/generation-status",
                """{"planId":"p2","generationStatus":"failed","error":"The AI service was busy. Try again in a minute."}""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            click("New AI plan")
            awaitNode(hasText("AI plans are written by the AI Coach. Turn it on to generate one."))
            click("Enable AI Coach")
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/preferences").isNotEmpty() }
            assertTrue(""""aiCoachEnabled":true""" in api.sent("PATCH", "/api/v1/preferences").single().body.orEmpty())

            awaitNode(hasText("Archive Hyrox block", substring = true))
            click("Archive Hyrox block", substring = true)
            onNode(hasSetTextAction() and hasContentDescription("Goal")).performTextInput("Get stronger")
            click("Generate plan")
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/plans/generate").isNotEmpty() }
            assertFalse("supersedePlanIds" in api.sent("POST", "/api/v1/plans/generate").single().body.orEmpty())

            // A plan the server gave up on goes back to the form, saying why.
            awaitNode(hasText("The AI service was busy. Try again in a minute."))
            awaitNode(hasText("Generate plan"))
        }
    }
}

/** An athlete who finished setup, on a live plan that runs over the next eight weeks. */
private fun FakeApi.accountWithLivePlan(aiCoachOn: Boolean) {
    privacyAcknowledged()
    on(
        "GET",
        "/api/v1/preferences",
        """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","aiCoachEnabled":$aiCoachOn}""",
    )
    on("GET", "/api/v1/timeline", "[${FakeApi.plannedToday("Tempo intervals")}]")
    val today = LocalDate.now(ZoneOffset.UTC)
    on(
        "GET",
        "/api/v1/plans",
        """[{"id":"p1","userId":"u1","name":"Hyrox block","totalWeeks":8,"generationStatus":"ready",""" +
            """"startDate":"${today.minusDays(TWO_WEEKS)}","endDate":"${today.plusDays(SIX_WEEKS)}"}]""",
    )
}

private const val TWO_WEEKS = 14L
private const val SIX_WEEKS = 42L

private fun fact(text: String, active: Boolean) =
    """{"id":"$text","userId":"u1","fact":"$text","dedupeKey":"$text","category":"constraint","source":"athlete",""" +
        """"active":$active,"reviewOn":"2027-02-01","createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.click(label: String, substring: Boolean = false) {
    // A row's label merges into its clickable parent, so wait on the merged tree.
    val node = hasText(label, substring = substring) and hasClickAction()
    waitUntil(timeoutMillis = 10_000) { onAllNodes(node).fetchSemanticsNodes().isNotEmpty() }
    onNode(node).performSemanticsAction(SemanticsActions.OnClick)
}
