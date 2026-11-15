package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * An upcoming session as the web shows it: its card's badges and the coach's
 * note that opens in place, then its sheet's cards, and the changes the sheet
 * makes where it stands (how much the session matters, its name, its day).
 */
@OptIn(ExperimentalTestApi::class)
class SessionSheetUiTest {
    private val tomorrow = LocalDate.now(ZoneOffset.UTC).plusDays(1).toString()

    private val session = listOf(
        """"id":"plan-d1","date":"$tomorrow","type":"planned","status":"planned","planDayId":"d1"""",
        """"focus":"Threshold Run","mainWorkout":"3 x 10 min at threshold","accessory":"Core circuit"""",
        """"planName":"AI Plan: sub-75 Hyrox","dayName":"Monday","priority":"key"""",
        """"aiSource":"review","aiRationale":"Progresses last week's tempo work.","aiNoteUpdatedAt":"${FakeApi.today}T08:00:00.000Z"""",
        """"aiInputsUsed":{"planGoalPresent":true,"recentWorkoutCount":10}""",
        """"exerciseSets":[{"id":"s1","exerciseName":"tempo_run","category":"running","setNumber":1,"time":10,"version":1}]""",
        """"sessionEstimate":{"durationMin":30,"rpe":6,"source":"sets","clamped":false}""",
    ).joinToString(",", "{", "}")

    private fun api() = FakeApi().apply {
        establishedAccount(session)
        on("PATCH", "/api/v1/plans/days/d1", "{}")
        // The server's fuller estimate fails, as it does offline: the sheet has only what the timeline carries.
        on("GET", "/api/v1/nutrition/planned-session-estimate/d1", """{"error":"Unavailable","code":"INTERNAL"}""", status = 503)
    }

    private fun ComposeUiTest.openSession() {
        awaitNode(hasText("Threshold Run"))
        onNode(hasText("Threshold Run") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
    }

    @Test
    fun theCardCarriesItsBadgesAndItsCoachsNoteOpensInPlace() = appTest(FakeAuth(AuthState.SignedIn("u1")), api()) {
        awaitNode(hasText("Threshold Run"))
        // Sentence-case badges, as on the web: the status, the tier, the plan and its day.
        for (badge in listOf("Planned", "Key", "AI Plan: sub-75 Hyrox", "Monday")) {
            assertTrue(onAllNodesWithText(badge, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty(), "no \"$badge\" badge")
        }
        awaitNode(hasText("Core circuit"))

        // The note is one closed line; opening it shows the coach's reason and what it went on, and leaves the card shut.
        val note = hasText("Coach's note · updated today") and hasClickAction()
        awaitNode(hasText("Coach's note · updated today"))
        assertTrue(onAllNodesWithText("Progresses last week's tempo work.", useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
        onNode(note).performSemanticsAction(SemanticsActions.OnClick)
        awaitNode(hasText("Progresses last week's tempo work."))
        awaitNode(hasText("Based on:"))
        awaitNode(hasText("Plan goal"))
        awaitNode(hasText("10 recent workouts"))
        assertTrue(onAllNodesWithText("Why this workout", useUnmergedTree = true).fetchSemanticsNodes().isEmpty(), "the sheet opened")
    }

    @Test
    fun theSheetShowsTheSessionInCardsAndItsFuelStartsFromTheCardsEstimate() = appTest(FakeAuth(AuthState.SignedIn("u1")), api()) {
        openSession()

        awaitNode(hasText("Why this workout"))
        awaitNode(hasText("PRESCRIBED"))
        awaitNode(hasText("ACCESSORY"))
        // The coach's own text is behind its disclosure, so the chips lead.
        assertTrue(onAllNodesWithText("3 x 10 min at threshold", useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
        onNode(hasText("Full prescription") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
        awaitNode(hasText("3 x 10 min at threshold"))

        // Without the server's estimate the panel still has the timeline's 30 minutes at RPE 6, folded away,
        // rather than an hour's defaults behind open fields.
        awaitNode(hasText("Adjust session estimate · 30 min · RPE 6"))
        assertTrue(onAllNodes(hasContentDescription("Increase expected duration")).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun theSheetChangesHowMuchTheSessionMattersItsNameAndItsDay() {
        val api = api()
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            openSession()
            awaitNode(hasText("How much does this session matter?"))
            awaitNode(hasText("The plan is built on it. If it's missed, it's worth fitting back in."))

            // Each change is saved, and the server keeps it: the timeline it answers with next has the change.
            val supporting = session.replace("\"priority\":\"key\"", "\"priority\":\"supporting\"")
            api.on("GET", "/api/v1/timeline", "[$supporting]")
            onNode(hasText("Supporting") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").isNotEmpty() }
            assertTrue("\"priority\":\"supporting\"" in api.sent("PATCH", "/api/v1/plans/days/d1").first().body.orEmpty())
            // A chip merges its label into the chip that's selected.
            waitUntil(timeoutMillis = 10_000) { onAllNodes(hasText("Supporting") and isSelected()).fetchSemanticsNodes().isNotEmpty() }
            awaitNode(hasText("Volume around the key sessions. If it's missed, fit it in when there's room."))

            api.on("GET", "/api/v1/timeline", "[${supporting.replace("Threshold Run", "Cruise intervals")}]")
            onNodeWithContentDescription("Rename workout").performSemanticsAction(SemanticsActions.OnClick)
            onNode(hasSetTextAction() and hasContentDescription("Workout title")).performTextReplacement("Cruise intervals")
            onNodeWithContentDescription("Save title").performSemanticsAction(SemanticsActions.OnClick)
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/days/d1").size == 2 }
            assertTrue("\"focus\":\"Cruise intervals\"" in api.sent("PATCH", "/api/v1/plans/days/d1").last().body.orEmpty())
            awaitNode(hasText("Cruise intervals"))

            onNodeWithText("Move to another day").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Pick a new date"))
        }
    }
}
