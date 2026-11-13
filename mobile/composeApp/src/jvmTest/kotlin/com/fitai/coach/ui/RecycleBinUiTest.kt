package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Settings → Recycle bin, end to end: the bin lists what was deleted, a
 * restore puts one back and says so, and deleting forever or emptying the
 * bin asks first.
 */
@OptIn(ExperimentalTestApi::class)
class RecycleBinUiTest {
    @Test
    fun aDeletedWorkoutIsRestoredAndAPlanDeletedForever() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/recycle-bin", BIN)
            on("POST", "/api/v1/recycle-bin/r1/restore", """{"ok":true,"entityType":"workout_log","entityId":"w1","warnings":[]}""")
            on("DELETE", "/api/v1/recycle-bin/r2", """{"success":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600) {
            openBin()
            awaitNode(hasText("Tempo run"))
            tap(hasContentDescription("Restore Tempo run") and hasClickAction())
            awaitNode(hasText("Restored"))
            assertEquals(1, api.sent("POST", "/api/v1/recycle-bin/r1/restore").size)
            // Restored, it leaves the bin.
            waitUntil(timeoutMillis = 10_000) { onAllNodes(hasText("Tempo run")).fetchSemanticsNodes().isEmpty() }

            tap(hasContentDescription("Delete Spring block forever") and hasClickAction())
            awaitNode(hasText("Delete forever?"))
            tap(hasText("Delete forever") and hasClickAction())
            awaitNode(hasText("Deleted forever"))
            assertEquals(1, api.sent("DELETE", "/api/v1/recycle-bin/r2").size)
            awaitNode(hasText("Nothing in the bin", substring = true))
        }
    }

    @Test
    fun emptyingTheBinAsksFirst() {
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/recycle-bin", BIN)
            on("DELETE", "/api/v1/recycle-bin", """{"success":true,"purgedCount":2}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, height = 1600) {
            openBin()
            tap(hasText("Empty bin") and hasClickAction())
            awaitNode(hasText("2 items will be permanently deleted. This cannot be undone."))
            assertTrue(api.sent("DELETE", "/api/v1/recycle-bin").isEmpty())
            // The dialog's confirm, not the sheet's button behind it.
            waitUntil(timeoutMillis = 10_000) { onAllNodes(hasText("Empty bin") and hasClickAction()).fetchSemanticsNodes().size == 2 }
            onAllNodes(hasText("Empty bin") and hasClickAction())[1].performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("2 items deleted forever"))
            assertEquals(1, api.sent("DELETE", "/api/v1/recycle-bin").size)
        }
    }
}

private const val BIN =
    """{"items":[""" +
        """{"id":"r1","entityType":"workout_log","entityId":"w1","label":"Tempo run","summary":"5 x 1 km","entityDate":"2026-11-09",""" +
        """"childCount":3,"deletedAt":"2026-11-10T09:00:00Z","expiresAt":"2027-02-08T09:00:00Z"},""" +
        """{"id":"r2","entityType":"training_plan","entityId":"p9","label":"Spring block","childCount":40,""" +
        """"deletedAt":"2026-11-11T09:00:00Z","expiresAt":"2027-02-09T09:00:00Z"}""" +
        """],"counts":{"total":2,"workout_log":1,"plan_day":0,"training_plan":1}}"""

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openBin() {
    awaitNode(hasContentDescription("Settings"))
    onNode(hasContentDescription("Settings")).performSemanticsAction(SemanticsActions.OnClick)
    val open = hasText("Open recycle bin (2 items)") and hasClickAction()
    waitUntil(timeoutMillis = 10_000) { onAllNodes(hasScrollAction()).fetchSemanticsNodes().isNotEmpty() }
    waitUntil(timeoutMillis = 10_000) { onAllNodes(open).fetchSemanticsNodes().isNotEmpty() }
    onAllNodes(hasScrollAction()).onFirst().performScrollToNode(open)
    tap(open)
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.tap(matcher: SemanticsMatcher) {
    waitUntil(timeoutMillis = 10_000) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
    onNode(matcher).performSemanticsAction(SemanticsActions.OnClick)
}
