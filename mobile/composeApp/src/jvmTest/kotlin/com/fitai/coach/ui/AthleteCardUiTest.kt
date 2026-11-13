package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Settings → Athlete card, end to end: a fact past its review date asks
 * "Still true?", a new fact is saved with its category, retiring asks first,
 * and the older free-text note can be moved onto the card.
 */
@OptIn(ExperimentalTestApi::class)
class AthleteCardUiTest {
    @Test
    fun aDueFactAsksWhetherItIsStillTrueAndANewFactIsSavedWithItsCategory() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/athlete-facts", "[${fact("f1", "No box jumps", reviewOn = "2020-01-01")}]")
            on("PATCH", "/api/v1/athlete-facts/f1", fact("f1", "No box jumps", reviewOn = "2099-01-01"))
            on("POST", "/api/v1/athlete-facts", fact("f2", "No sled at my gym", category = "equipment"))
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600) {
            openSettings()
            scrollTo(hasText("Yes, still true") and hasClickAction())
            tap(hasText("Yes, still true") and hasClickAction())
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/athlete-facts/f1").isNotEmpty() }
            assertEquals("""{"confirm":true}""", api.sent("PATCH", "/api/v1/athlete-facts/f1").single().body)
            awaitNode(hasText("Kept on your athlete card"))
            waitUntil(timeoutMillis = 10_000) { onAllNodes(hasText("Still true?")).fetchSemanticsNodes().isEmpty() }

            val field = hasSetTextAction() and hasContentDescription("Add a fact")
            scrollTo(field)
            onNode(field).performTextInput("No sled at my gym")
            tap(hasText("Equipment") and hasClickAction())
            tap(hasText("Add") and hasClickAction())
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/athlete-facts").isNotEmpty() }
            assertEquals(
                """{"fact":"No sled at my gym","category":"equipment"}""",
                api.sent("POST", "/api/v1/athlete-facts").single().body,
            )
            awaitNode(hasText("Saved to your athlete card"))
            awaitNode(hasText("No sled at my gym"))
        }
    }

    @Test
    fun retiringAsksFirstAndTheOlderNoteMovesOntoTheCard() {
        val api = FakeApi().apply {
            establishedAccount()
            on(
                "GET",
                "/api/v1/auth/user",
                """{"id":"u1","userTimezone":"UTC","onboardingCompleted":true,""" +
                    """"trainingConstraints":"Sore left knee. No running on Tuesdays."}""",
            )
            on("GET", "/api/v1/athlete-facts", "[${fact("f1", "No box jumps")}]")
            on("PATCH", "/api/v1/athlete-facts/f1", fact("f1", "No box jumps", active = false))
            on("POST", "/api/v1/athlete-facts/import", """{"added":2,"skipped":0}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600) {
            openSettings()
            val retire = hasContentDescription("Retire \"No box jumps\"") and hasClickAction()
            scrollTo(retire)
            tap(retire)
            awaitNode(hasText("Retire this fact?"))
            tap(hasText("Retire") and hasClickAction())
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/athlete-facts/f1").isNotEmpty() }
            assertEquals("""{"active":false}""", api.sent("PATCH", "/api/v1/athlete-facts/f1").single().body)
            awaitNode(hasText("Retired (1)"))

            scrollTo(hasText("Your older injuries note"))
            awaitNode(hasText("Sore left knee. No running on Tuesdays."))
            tap(hasText("Add to card") and hasClickAction())
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/athlete-facts/import").isNotEmpty() }
            awaitNode(hasText("Note added to your athlete card"))
        }
    }
}

private fun fact(id: String, text: String, reviewOn: String = "2099-01-01", active: Boolean = true, category: String = "constraint") =
    """{"id":"$id","userId":"u1","fact":"$text","dedupeKey":"$id","category":"$category","source":"athlete",""" +
        """"active":$active,"reviewOn":"$reviewOn","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}"""

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openSettings() {
    awaitNode(hasContentDescription("Settings"))
    onNode(hasContentDescription("Settings")).performSemanticsAction(SemanticsActions.OnClick)
    awaitNode(hasText("Athlete card"))
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.scrollTo(matcher: SemanticsMatcher) {
    waitUntil(timeoutMillis = 10_000) { onAllNodes(hasScrollAction()).fetchSemanticsNodes().isNotEmpty() }
    waitUntil(timeoutMillis = 10_000) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
    onAllNodes(hasScrollAction()).onFirst().performScrollToNode(matcher)
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.tap(matcher: SemanticsMatcher) {
    waitUntil(timeoutMillis = 10_000) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
    onNode(matcher).performSemanticsAction(SemanticsActions.OnClick)
}
