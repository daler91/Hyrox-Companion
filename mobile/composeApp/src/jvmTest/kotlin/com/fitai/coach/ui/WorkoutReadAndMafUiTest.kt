package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val WORKOUT = "/api/v1/workouts/w1"
private const val MAF = "/api/v1/workouts/w1/maf-test"

private fun workout(extra: String = "", sets: String = "") =
    """{"id":"w1","userId":"u1","date":"${FakeApi.today}","focus":"Easy run","mainWorkout":"4 x 1 km at threshold",""" +
        """"countsAsTraining":true,"autoLinkRecordingOnly":false,"deviceActivity":{},"exerciseSets":[$sets],"structureBlocks":[]$extra}"""

private fun set(id: String, number: Int) =
    """{"id":"$id","workoutLogId":"w1","exerciseName":"back_squat","category":"strength","setNumber":$number,"reps":5,"version":1}"""

private fun mafTest(avgHr: Int) =
    """{"testResult":{"id":"t1","userId":"u1","protocolType":"maf_test","version":1,""" +
        """"conditions":{"source":"workout_tag","workoutLogId":"w1"},""" +
        """"metrics":{"avgHeartRate":$avgHr,"durationSeconds":2700,"distanceMeters":7000,"mafCeilingUsed":140}},"analysis":null}"""

/** A logged workout's text read into sets, and the run tagged, corrected and untagged as a MAF test. */
@OptIn(ExperimentalTestApi::class)
class WorkoutReadAndMafUiTest {
    private fun FakeApi.loggedRun(workoutJson: String) {
        establishedAccount(
            """{"id":"log-w1","date":"${FakeApi.today}","type":"logged","status":"completed",""" +
                """"focus":"Easy run","mainWorkout":"4 x 1 km at threshold","workoutLogId":"w1"}""",
        )
        on("GET", WORKOUT, workoutJson)
    }

    @Test
    fun theWorkoutsTextIsReadIntoSetsAndReadingAgainAsksBeforeReplacingThem() {
        val api = FakeApi().apply {
            loggedRun(workout())
            on("POST", "$WORKOUT/reparse", """{"exercises":[],"saved":true,"setCount":2,"rejectedCount":0,"rejectionReasons":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Easy run"))
            onAllNodesWithText("Easy run").onLast().performClick()
            awaitNode(hasText("No structured sets for this workout."))
            onNodeWithText("Read the workout's text, or a photo of it, into sets you can edit.").assertExists()

            // The server reads the text it has; the new sets show.
            api.on("GET", WORKOUT, workout(sets = "${set("s1", 1)},${set("s2", 2)}"))
            onNodeWithText("Read the text").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Found 2 sets"))
            awaitNode(hasText("Back Squat"))
            assertEquals("{}", api.sent("POST", "$WORKOUT/reparse").single().body)

            // Now there are sets to lose: it asks first, and a cancel reads nothing.
            onNodeWithText("Read the text").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Replace the sets?"))
            onNodeWithText("The workout's 2 sets are replaced with the ones read in. Edits you've made to them are lost.").assertExists()
            onNodeWithText("cancel").performClick()
            onNodeWithText("Read the text").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Replace"))
            onNodeWithText("Replace").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "$WORKOUT/reparse").size == 2 }
        }
    }

    @Test
    fun aMafAthleteTagsARunCorrectsItAndTakesItOutOfTheTrend() {
        val api = FakeApi().apply {
            loggedRun(workout(""","avgHeartrate":138,"duration":45,"distanceMeters":7000"""))
            on(
                "GET",
                "/api/v1/preferences",
                """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km",""" +
                    """"trainingStyleId":"maf_method","mafHr":140}""",
            )
            on("GET", "/api/v1/maf-tests", """{"tests":[],"analysis":[],"workoutDates":{}}""")
            on("POST", MAF, mafTest(avgHr = 138))
            on("PATCH", MAF, mafTest(avgHr = 136))
            on("DELETE", MAF, """{"success":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Easy run"))
            onAllNodesWithText("Easy run").onLast().performClick()
            awaitNode(hasText("Track your pace at the same heart rate over time."))

            // Seeded from the run: its minutes as mm:ss, its metres in km.
            onNode(hasText("Tag") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasSetTextAction() and hasContentDescription("Avg heart rate (bpm)"))
            onNode(hasSetTextAction() and hasContentDescription("Avg heart rate (bpm)")).assert(hasText("138"))
            onNode(hasSetTextAction() and hasContentDescription("Duration (mm:ss)")).assert(hasText("45:00"))
            onNode(hasSetTextAction() and hasContentDescription("Distance (km)")).assert(hasText("7"))

            // A max below the average is caught before anything is sent.
            onNode(hasSetTextAction() and hasContentDescription("Max heart rate (bpm)")).performTextReplacement("120")
            onAllNodes(hasText("Tag as MAF test") and hasClickAction()).onLast().performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Max heart rate can't be lower than average heart rate."))
            assertTrue(api.sent("POST", MAF).isEmpty())

            onNode(hasSetTextAction() and hasContentDescription("Max heart rate (bpm)")).performTextReplacement("150")
            onAllNodes(hasText("Tag as MAF test") and hasClickAction()).onLast().performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Tracked in your MAF trend"))
            awaitNode(hasText("Tagged as MAF test"))
            assertEquals(
                """{"metrics":{"avgHeartRate":138,"maxHeartRate":150,"durationSeconds":2700,"distanceMeters":7000.0}}""",
                api.sent("POST", MAF).single().body,
            )

            // Correcting starts from what was saved.
            onNodeWithContentDescription("Edit MAF test").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Edit MAF test"))
            onNode(hasSetTextAction() and hasContentDescription("Avg heart rate (bpm)")).performTextReplacement("136")
            onNode(hasText("Save changes") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Updated MAF test"))
            assertTrue(""""avgHeartRate":136""" in api.sent("PATCH", MAF).single().body.orEmpty())

            // Removing asks first.
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasContentDescription("Remove MAF test"))
            onNodeWithContentDescription("Remove MAF test").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Remove MAF test?"))
            onNodeWithText("Remove").performClick()
            awaitNode(hasText("Removed from MAF trend"))
            awaitNode(hasText("Track your pace at the same heart rate over time."))
            assertEquals(1, api.sent("DELETE", MAF).size)
        }
    }
}
