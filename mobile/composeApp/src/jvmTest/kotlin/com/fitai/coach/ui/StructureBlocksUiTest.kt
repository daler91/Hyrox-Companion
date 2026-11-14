package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val SCORE = "/api/v1/workouts/w1/structure-blocks/b1/score"

private fun amrap(score: String = "null") =
    """{"id":"b1","sectionType":"main","formatType":"amrap","timeCapMinutes":12,"score":$score,"sequenceOrder":0,"sortOrder":0,""" +
        """"steps":[{"stepNumber":1,"stepType":"work","exerciseName":"burpees","targets":{"targetReps":10}},""" +
        """{"stepNumber":2,"stepType":"work","exerciseName":"wall_balls","targets":{"targetReps":15}}]}"""

private const val STEADY =
    """{"id":"b2","sectionType":"cooldown","formatType":"steady","durationMinutes":10,"score":null,"sequenceOrder":1,"sortOrder":0,""" +
        """"steps":[{"stepNumber":1,"stepType":"work","exerciseName":"running"}]}"""

/** A logged workout's structure blocks, and an AMRAP's result recorded, corrected and cleared. */
@OptIn(ExperimentalTestApi::class)
class StructureBlocksUiTest {
    @Test
    fun aBlocksResultIsRecordedCorrectedAndCleared() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount(
                """{"id":"log-w1","date":"$today","type":"logged","status":"completed",""" +
                    """"focus":"Metcon","mainWorkout":"","workoutLogId":"w1"}""",
            )
            on(
                "GET",
                "/api/v1/workouts/w1",
                """{"id":"w1","userId":"u1","date":"$today","focus":"Metcon","mainWorkout":"","countsAsTraining":true,""" +
                    """"autoLinkRecordingOnly":false,"deviceActivity":{},"exerciseSets":[],"structureBlocks":[$STEADY,${amrap()}]}""",
            )
            on("PATCH", SCORE, """{"structureBlocks":[${amrap("""{"type":"amrap","rounds":5,"reps":12,"notes":null}""")},$STEADY]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Metcon"))
            onAllNodesWithText("Metcon").onLast().performClick()
            awaitNode(hasText("Structure"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Record result"))

            // In the order they were done, with each block's setup and steps; only the AMRAP takes a result.
            onNodeWithText("Block 1 · Main").assertExists()
            onNodeWithText("As Many Rounds As Possible · 12 min cap").assertExists()
            onNodeWithText("• Burpees · 10 reps").assertExists()
            onNodeWithText("Not recorded yet").assertExists()
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Block 2 · Cool-down"))
            onNodeWithText("10 min").assertExists()
            assertEquals(1, onAllNodesWithText("Record result").fetchSemanticsNodes().size)

            // A fraction is caught before anything is sent.
            onNode(hasText("Record result") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("How did it go?"))
            onNode(hasSetTextAction() and hasContentDescription("Full rounds done")).performTextReplacement("5.5")
            onNode(hasText("Save result") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Full rounds done must be a whole number from 0 to 10,000."))
            assertTrue(api.sent("PATCH", SCORE).isEmpty())

            onNode(hasSetTextAction() and hasContentDescription("Full rounds done")).performTextReplacement("5")
            onNode(hasSetTextAction() and hasContentDescription("Extra reps in last round")).performTextReplacement("12")
            onNode(hasText("Save result") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Result saved"))
            awaitNode(hasText("5 rounds + 12 reps"))
            assertEquals(
                """{"score":{"type":"amrap","rounds":5,"reps":12,"notes":null}}""",
                api.sent("PATCH", SCORE).single().body,
            )

            // A saved result can be cleared.
            api.on("PATCH", SCORE, """{"structureBlocks":[${amrap()},$STEADY]}""")
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Edit result"))
            onNode(hasText("Edit result") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Clear result"))
            onNode(hasText("Clear result") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Result cleared"))
            awaitNode(hasText("Not recorded yet"))
            assertEquals("""{"score":null}""", api.sent("PATCH", SCORE).last().body)
        }
    }
}
