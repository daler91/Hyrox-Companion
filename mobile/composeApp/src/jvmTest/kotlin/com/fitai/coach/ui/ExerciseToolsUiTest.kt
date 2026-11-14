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
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertTrue

private const val WORKOUT = "/api/v1/workouts/w1"

private fun squat(id: String, setNumber: Int, reps: Int, planned: Int? = null, exercise: String = "back_squat") =
    """{"id":"$id","workoutLogId":"w1","exerciseName":"$exercise","category":"strength","setNumber":$setNumber,""" +
        """"reps":$reps,"weight":60,"weightUnit":"kg"${planned?.let { ""","plannedReps":$it""" } ?: ""},"version":1}"""

private val workout =
    """{"id":"w1","userId":"u1","date":"${FakeApi.today}","focus":"Leg day","mainWorkout":"","countsAsTraining":true,""" +
        """"autoLinkRecordingOnly":false,"deviceActivity":{},"suggestedRpe":7,""" +
        """"exerciseSets":[${squat("s1", 1, 4, planned = 5)},${squat("s2", 2, 4, planned = 5)}],"structureBlocks":[]}"""

private const val LAST_TIME =
    """[{"id":"h1","workoutLogId":"w0","exerciseName":"back_squat","category":"strength","setNumber":1,"reps":8,"weight":70,""" +
        """"weightUnit":"kg","date":"2026-11-01","version":1},""" +
        """{"id":"h2","workoutLogId":"w0","exerciseName":"back_squat","category":"strength","setNumber":2,"reps":8,"weight":70,""" +
        """"weightUnit":"kg","date":"2026-11-01","version":1}]"""

/** An exercise's tools on workout detail: Use last, planned differences, the HR RPE, set notes, change and delete. */
@OptIn(ExperimentalTestApi::class)
class ExerciseToolsUiTest {
    private fun api() = FakeApi().apply {
        establishedAccount(
            """{"id":"log-w1","date":"${FakeApi.today}","type":"logged","status":"completed",""" +
                """"focus":"Leg day","mainWorkout":"","workoutLogId":"w1"}""",
        )
        on(
            "GET",
            "/api/v1/preferences",
            """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","showAdherenceInsights":true}""",
        )
        on("GET", WORKOUT, workout)
        on("GET", "/api/v1/exercises/back_squat/history", LAST_TIME)
        on("PATCH", WORKOUT, workout)
        on("PATCH", "$WORKOUT/sets/s1", squat("s1", 1, 8))
        on("PATCH", "$WORKOUT/sets/s2", squat("s2", 2, 8))
        on("DELETE", "$WORKOUT/sets/s1", """{"success":true}""")
        on("DELETE", "$WORKOUT/sets/s2", """{"success":true}""")
    }

    @Test
    fun lastTimeFillsTheSetsAndThePlanAndHeartRateShow() {
        val api = api()
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Leg day"))
            onAllNodesWithText("Leg day").onLast().performClick()
            awaitNode(hasText("Your heart rate suggests RPE 7."))

            onNode(hasText("Save RPE 7") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", WORKOUT).isNotEmpty() }
            assertTrue(""""rpe":7""" in api.sent("PATCH", WORKOUT).single().body.orEmpty())

            // The saved RPE takes the suggestion away, which moves everything below it up.
            waitUntil(timeoutMillis = 10_000) { onAllNodesWithText("Your heart rate suggests RPE 7.").fetchSemanticsNodes().isEmpty() }

            // Last time arrives with the exercise's history, on its card further down: scroll until it's there.
            waitUntil(timeoutMillis = 30_000) {
                onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasContentDescription("options for Back Squat"))
                onAllNodes(hasText("Use last"), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
            }
            onNodeWithText("planned 5 reps").assertExists()
            onNode(hasText("Use last") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            // Each set goes through the outbox, in either order.
            waitUntil(timeoutMillis = 10_000) {
                api.sent("PATCH", "$WORKOUT/sets/s1").isNotEmpty() && api.sent("PATCH", "$WORKOUT/sets/s2").isNotEmpty()
            }
            assertTrue(""""reps":8""" in api.sent("PATCH", "$WORKOUT/sets/s1").single().body.orEmpty())
            assertTrue(""""weight":70.0""" in api.sent("PATCH", "$WORKOUT/sets/s2").single().body.orEmpty())
        }
    }

    @Test
    fun aSetTakesANoteAndAnExerciseIsChangedThenDeleted() {
        val api = api()
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Leg day"))
            onAllNodesWithText("Leg day").onLast().performClick()
            awaitNode(hasContentDescription("options for Back Squat"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasContentDescription("options for Back Squat"))

            // A note on the first set.
            onNode(hasClickAction() and hasText("Set 1")).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasSetTextAction() and hasContentDescription("Notes for set 1"))
            onNode(hasSetTextAction() and hasContentDescription("Notes for set 1")).performTextInput("Felt heavy")
            onNode(hasText("Save") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "$WORKOUT/sets/s1").isNotEmpty() }
            assertTrue(""""notes":"Felt heavy"""" in api.sent("PATCH", "$WORKOUT/sets/s1").last().body.orEmpty())

            // Changed to wall balls: every set moves, values kept.
            onNodeWithContentDescription("options for Back Squat").performSemanticsAction(SemanticsActions.OnClick)
            onNodeWithText("Change exercise").performClick()
            awaitNode(hasText("Replace Back Squat with another exercise. Your reps, weight, and other set values stay the same."))
            // The server answers with the sets as wall balls.
            api.on("PATCH", "$WORKOUT/sets/s1", squat("s1", 1, 4, exercise = "wall_balls"))
            api.on("PATCH", "$WORKOUT/sets/s2", squat("s2", 2, 4, exercise = "wall_balls"))
            onNode(hasSetTextAction() and hasContentDescription("Search exercises")).performTextInput("wall")
            awaitNode(hasText("Wall Balls"))
            onNodeWithText("Wall Balls").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "$WORKOUT/sets/s2").isNotEmpty() }
            val changed = api.sent("PATCH", "$WORKOUT/sets/s2").last().body.orEmpty()
            assertTrue(""""exerciseName":"wall_balls"""" in changed && """"reps"""" !in changed, changed)

            // Deleted, with its sets, after asking.
            awaitNode(hasContentDescription("options for Wall Balls"))
            onNodeWithContentDescription("options for Wall Balls").performSemanticsAction(SemanticsActions.OnClick)
            onNodeWithText("Delete exercise").performClick()
            awaitNode(hasText("Wall Balls and all 2 sets will be permanently removed from this workout."))
            onNodeWithText("Delete").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("DELETE", "$WORKOUT/sets/s2").isNotEmpty() }
            assertTrue(api.sent("DELETE", "$WORKOUT/sets/s1").isNotEmpty())
        }
    }
}
