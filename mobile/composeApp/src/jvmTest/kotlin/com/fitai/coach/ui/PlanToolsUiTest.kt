package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.core.dates.nextPlanStartDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A plan's tools from the timeline, end to end: rename, goal, reschedule, archive, and delete with undo. */
@OptIn(ExperimentalTestApi::class)
class PlanToolsUiTest {
    @Test
    fun aPlanIsRenamedGivenAGoalRescheduledAndArchived() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("PATCH", "/api/v1/plans/p1", PLAN)
            on("PATCH", "/api/v1/plans/p1/goal", PLAN)
            on("POST", "/api/v1/plans/p1/schedule", """{"success":true}""")
            on("PATCH", "/api/v1/plans/p1/retirement", PLAN)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            openPlan()

            tool("Rename plan")
            val name = hasSetTextAction() and hasContentDescription("Plan name")
            awaitNode(name)
            onNode(name).performTextReplacement("Spring block")
            click("Save")
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/p1").isNotEmpty() }
            assertEquals("""{"name":"Spring block"}""", api.sent("PATCH", "/api/v1/plans/p1").single().body)

            // The goal line opens the goal straight away.
            click("No plan goal set")
            val goal = hasSetTextAction() and hasContentDescription("What are you training towards?")
            awaitNode(goal)
            onNode(goal).performTextInput("Sub-90 Hyrox in May")
            click("Save goal")
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/p1/goal").isNotEmpty() }
            assertEquals("""{"goal":"Sub-90 Hyrox in May"}""", api.sent("PATCH", "/api/v1/plans/p1/goal").single().body)

            // Reschedule offers the next Monday-style start for a plan that has none.
            tool("Reschedule")
            click("Schedule plan")
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/plans/p1/schedule").isNotEmpty() }
            assertEquals(
                """{"startDate":"${nextPlanStartDate(today)}"}""",
                api.sent("POST", "/api/v1/plans/p1/schedule").single().body,
            )

            tool("Archive plan")
            awaitNode(hasText("Archive this plan?"))
            click("Archive")
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/plans/p1/retirement").isNotEmpty() }
            assertEquals("""{"retiredOn":"$today"}""", api.sent("PATCH", "/api/v1/plans/p1/retirement").single().body)
        }
    }

    @Test
    fun aDeletedPlanComesBackWithUndo() {
        val api = FakeApi().apply {
            establishedAccount(FakeApi.plannedToday("Tempo intervals"))
            on("DELETE", "/api/v1/plans/p1", """{"success":true,"recycleBinItemId":"rb1"}""")
            on("POST", "/api/v1/recycle-bin/rb1/restore", """{"ok":true,"entityType":"training_plan","entityId":"p1","warnings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            openPlan()
            tool("Delete plan")
            awaitNode(hasText("Delete training plan?"))
            click("Delete")

            awaitNode(hasText("Undo"))
            assertEquals(1, api.sent("DELETE", "/api/v1/plans/p1").size)
            click("Undo")
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/recycle-bin/rb1/restore").isNotEmpty() }
            assertTrue(api.sent("GET", "/api/v1/plans").size >= 2)
        }
    }
}

private const val PLAN = """{"id":"p1","userId":"u1","name":"Spring block","totalWeeks":8,"generationStatus":"ready"}"""

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.openPlan() {
    awaitNode(hasText("Hyrox block (8 wk)"))
    click("Hyrox block (8 wk)")
    awaitNode(hasContentDescription("Plan tools"))
}

/** Opens the plan tools and picks [label]. */
@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.tool(label: String) {
    onNodeWithContentDescription("Plan tools").performSemanticsAction(SemanticsActions.OnClick)
    awaitNode(hasText(label))
    click(label)
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.click(label: String) {
    // A row's label merges into its clickable parent, so wait on the merged tree.
    val node = hasText(label) and hasClickAction()
    waitUntil(timeoutMillis = 10_000) { onAllNodes(node).fetchSemanticsNodes().isNotEmpty() }
    onNode(node).performSemanticsAction(SemanticsActions.OnClick)
}
