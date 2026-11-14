package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private val today = FakeApi.today

private fun logged(id: String, focus: String) =
    """{"id":"log-$id","date":"$today","type":"logged","status":"completed","focus":"$focus","mainWorkout":"","workoutLogId":"$id"}"""

private fun workout(id: String, focus: String, extra: String = "") =
    """{"id":"$id","userId":"u1","date":"$today","focus":"$focus","mainWorkout":"","countsAsTraining":true,""" +
        """"autoLinkRecordingOnly":false,"deviceActivity":{},"exerciseSets":[],"structureBlocks":[]$extra}"""

/** Picking workouts on the timeline and deleting them with one undo; combining two workouts from one's detail. */
@OptIn(ExperimentalTestApi::class)
class BulkDeleteAndCombineUiTest {
    @Test
    fun pickedWorkoutsAreDeletedTogetherAndOneUndoBringsThemAllBack() {
        val api = FakeApi().apply {
            establishedAccount(logged("w1", "Morning run"), logged("w2", "Evening lift"), FakeApi.plannedToday("Tempo intervals"))
            on(
                "POST",
                "/api/v1/workouts/bulk-delete",
                """{"success":true,"deletedWorkoutLogIds":["w1","w2"],"deletedPlanDayIds":[],"deletedCount":2,"batchId":"b1",""" +
                    """"recycleBinItemIds":["r1","r2"]}""",
            )
            on("POST", "/api/v1/recycle-bin/batches/b1/restore", """{"ok":true,"batchId":"b1","restored":[],"warnings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Morning run"))
            onNode(hasText("Select") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("0 selected"))
            onNodeWithText("3 visible workouts can be removed").assertExists()

            // A tap picks a card instead of opening it.
            onAllNodesWithText("Morning run").onLast().performClick()
            onNode(hasContentDescription("Select Evening lift")).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("2 selected"))

            onNode(hasText("Delete selected") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Delete selected workouts?"))
            onNodeWithText("Delete").performClick()

            awaitNode(hasText("2 workouts removed"))
            assertEquals("""{"workoutLogIds":["w1","w2"]}""", api.sent("POST", "/api/v1/workouts/bulk-delete").single().body)
            waitUntil(timeoutMillis = 10_000) { onAllNodesWithText("Morning run").fetchSemanticsNodes().isEmpty() }
            // The session nobody picked stays (on its card and in the week card).
            assertTrue(onAllNodesWithText("Tempo intervals").fetchSemanticsNodes().isNotEmpty())

            onNodeWithText("Undo").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/recycle-bin/batches/b1/restore").isNotEmpty() }
            awaitNode(hasText("Morning run"))
        }
    }

    @Test
    fun aWorkoutIsCombinedWithAnotherFromTheSameDay() {
        val api = FakeApi().apply {
            establishedAccount(logged("w1", "Morning run"), logged("w2", "Evening lift"))
            on("GET", "/api/v1/workouts/w1", workout("w1", "Morning run", ""","duration":30"""))
            on(
                "POST",
                "/api/v1/workouts/combine",
                """{"id":"w9","userId":"u1","date":"$today","focus":"Morning run","mainWorkout":"","countsAsTraining":true,""" +
                    """"autoLinkRecordingOnly":false,"deviceActivity":{}}""",
                status = 201,
            )
            on("GET", "/api/v1/workouts/w9", workout("w9", "Combined session"))
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Morning run"))
            onAllNodesWithText("Morning run").onLast().performClick()
            awaitNode(hasText("Delete workout"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Combine with another workout"))
            onNode(hasText("Combine with another workout") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)

            // Each field starts as both combined; the title keeps just this one's.
            awaitNode(hasText("Combine workouts"))
            onNodeWithText("Morning run + Evening lift").assertExists()
            onAllNodes(hasText("This workout") and hasClickAction()).onFirst().performSemanticsAction(SemanticsActions.OnClick)
            onAllNodes(hasText("Combine workouts") and hasClickAction()).onLast().performSemanticsAction(SemanticsActions.OnClick)

            // The combined workout takes this one's place.
            awaitNode(hasText("Workouts combined"))
            awaitNode(hasText("Combined session"))
            val sent = api.sent("POST", "/api/v1/workouts/combine").single().body.orEmpty()
            assertTrue(""""focus":"Morning run"""" in sent, sent)
            assertTrue(""""deleteWorkoutIds":["w1","w2"]""" in sent, sent)
            assertTrue(""""duration":30""" in sent, sent)
        }
    }
}
