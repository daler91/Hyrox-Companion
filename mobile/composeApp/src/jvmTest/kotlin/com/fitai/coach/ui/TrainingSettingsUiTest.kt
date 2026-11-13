package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Settings → Training, end to end: a card saves only what changed, a value
 * out of range keeps Save off and says why, and switching to MAF asks for the
 * setup first, then saves the switch with the ceiling it gives.
 */
@OptIn(ExperimentalTestApi::class)
class TrainingSettingsUiTest {
    @Test
    fun theHeartRateCardSavesWhatChangedAndRefusesAValueOutOfRange() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/preferences", PREFS)
            on("PATCH", "/api/v1/preferences", PREFS)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600) {
            openSettings()
            val resting = hasSetTextAction() and hasContentDescription("Resting heart rate (bpm)")
            scrollTo(resting)
            onNode(resting).performTextReplacement("25")
            awaitNode(hasText("Resting heart rate must be at least 30 bpm."))
            heartSave().assertIsNotEnabled()

            onNode(resting).performTextReplacement("48")
            heartSave().performSemanticsAction(SemanticsActions.OnClick)
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/preferences").isNotEmpty() }
            assertTrue(api.sent("PATCH", "/api/v1/preferences").single().body == """{"restingHr":48}""")
        }
    }

    @Test
    fun switchingToMafAsksForTheSetupThenSavesTheCeiling() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/preferences", PREFS)
            on(
                "PATCH",
                "/api/v1/preferences",
                PREFS.replace(
                    "\"balanced_default\"",
                    "\"maf_method\"",
                ).replace("}", ""","mafAge":40,"mafCategory":"consistent_up_to_2y","mafHr":140}"""),
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600) {
            openSettings()
            scrollTo(hasText("MAF Method") and hasClickAction())
            tap(hasText("MAF Method") and hasClickAction())
            tap(hasText("Confirm") and hasClickAction())

            awaitNode(hasText("Complete MAF setup to switch styles"))
            onNode(hasSetTextAction() and hasContentDescription("Age (required)")).performTextInput("40")
            tap(hasText("Training consistently (up to 2 years) without those problems") and hasClickAction())
            tap(hasText("Save MAF setup") and hasClickAction())

            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/preferences").isNotEmpty() }
            val body = api.sent("PATCH", "/api/v1/preferences").single().body.orEmpty()
            listOf(
                """"trainingStyleId":"maf_method"""",
                """"trainingStylePreviousId":"balanced_default"""",
                """"trainingStyleRecomputeNow":true""",
                """"mafAge":40""",
                """"mafCategory":"consistent_up_to_2y"""",
                """"mafHr":140""",
            ).forEach { assertTrue(it in body, body) }
            // The switch is said, and kept in this device's audit.
            awaitNode(hasText("Switched to MAF Method", substring = true))
            awaitNode(hasText("Balanced to MAF Method", substring = true))
            awaitNode(hasText("Your MAF ceiling is 140 bpm", substring = true))
        }
    }
}

private const val PREFS =
    """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","trainingStyleId":"balanced_default"}"""

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openSettings() {
    awaitNode(hasContentDescription("Settings"))
    onNode(hasContentDescription("Settings")).performSemanticsAction(SemanticsActions.OnClick)
    awaitNode(hasText("Race profile"))
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.scrollTo(matcher: SemanticsMatcher) {
    waitUntil(timeoutMillis = 10_000) { onAllNodes(hasScrollAction()).fetchSemanticsNodes().isNotEmpty() }
    onAllNodes(hasScrollAction()).onFirst().performScrollToNode(matcher)
}

/** The heart rate card's Save: the third card with one, after race profile and body composition. */
@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.heartSave() = onAllNodes(hasText("Save") and hasClickAction())[2]

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.tap(matcher: SemanticsMatcher) {
    waitUntil(timeoutMillis = 10_000) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
    onNode(matcher).performSemanticsAction(SemanticsActions.OnClick)
}
