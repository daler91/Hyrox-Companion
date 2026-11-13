package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** Renaming, setting the goal, scheduling, archiving and deleting a plan, and what each refreshes. */
class PlanToolsTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { newIdempotencyKey() })
    private val timeline = TimelineRepository(db, server.api, sync, CacheStore(db) { 0L })
    private val plans = PlanTools(server.api, timeline)

    @AfterTest
    fun closeDatabase() = db.close()

    private fun plan(name: String, goal: String? = null, retiredOn: String? = null) =
        """{"id":"p1","userId":"u1","name":"$name","totalWeeks":8,"generationStatus":"ready"""" +
            (goal?.let { ""","goal":"$it"""" } ?: "") + (retiredOn?.let { ""","retiredOn":"$it"""" } ?: "") + "}"

    private suspend fun cachedPlan() = timeline.plans.first()!!.single()

    @Test
    fun aRenameAndAGoalSendOnlyWhatChangedAndRefreshThePlans() = runTest {
        server.on("PATCH", "/api/v1/plans/p1", 200, plan("Spring block"))
        server.on("PATCH", "/api/v1/plans/p1/goal", 200, plan("Spring block"))
        server.on("GET", "/api/v1/plans", 200, "[${plan("Spring block", goal = "Sub-90 Hyrox")}]")

        plans.rename("p1", "  Spring block  ")
        plans.setGoal("p1", "   ")

        assertEquals("""{"name":"Spring block"}""", server.sentTo("PATCH", "/api/v1/plans/p1").single().body)
        // A blank goal clears it.
        assertEquals("""{"goal":null}""", server.sentTo("PATCH", "/api/v1/plans/p1/goal").single().body)
        assertEquals(2, server.sentTo("GET", "/api/v1/plans").size)
        assertEquals("Sub-90 Hyrox", cachedPlan().goal)
    }

    @Test
    fun schedulingAndArchivingRefreshThePlansAndTheTimeline() = runTest {
        server.on("POST", "/api/v1/plans/p1/schedule", 200, """{"success":true}""")
        server.on("PATCH", "/api/v1/plans/p1/retirement", 200, plan("Block", retiredOn = "2026-11-13"))
        server.on("GET", "/api/v1/plans", 200, "[${plan("Block", retiredOn = "2026-11-13")}]")
        server.on("GET", "/api/v1/timeline", 200, "[]")

        plans.schedule("p1", "2026-11-16")
        plans.setRetirement("p1", "2026-11-13")
        plans.setRetirement("p1", null)

        assertEquals("""{"startDate":"2026-11-16"}""", server.sentTo("POST", "/api/v1/plans/p1/schedule").single().body)
        val retirements = server.sentTo("PATCH", "/api/v1/plans/p1/retirement").map { it.body }
        assertEquals(listOf("""{"retiredOn":"2026-11-13"}""", """{"retiredOn":null}"""), retirements)
        assertEquals(3, server.sentTo("GET", "/api/v1/timeline").size)
        assertEquals("2026-11-13", cachedPlan().retiredOn)
    }

    @Test
    fun aDeletedPlanComesBackFromTheRecycleBin() = runTest {
        server.on("DELETE", "/api/v1/plans/p1", 200, """{"success":true,"recycleBinItemId":"rb1"}""")
        server.on(
            "POST",
            "/api/v1/recycle-bin/rb1/restore",
            200,
            """{"ok":true,"entityType":"training_plan","entityId":"p1","warnings":[]}""",
        )
        server.on("GET", "/api/v1/plans", 200, "[${plan("Block")}]")
        server.on("GET", "/api/v1/timeline", 200, "[]")

        assertEquals("rb1", plans.delete("p1"))
        plans.restore("rb1")

        assertEquals(1, server.sentTo("POST", "/api/v1/recycle-bin/rb1/restore").size)
        assertEquals("Block", cachedPlan().name)
    }

    @Test
    fun aRestoreOverAnotherLivePlanSaysWhy() = runTest {
        server.on(
            "PATCH",
            "/api/v1/plans/p1/retirement",
            409,
            """{"error":"Another plan already covers these dates","code":"PLAN_OVERLAP"}""",
        )

        val error = assertFailsWith<ApiException> { plans.setRetirement("p1", null) }

        assertEquals("PLAN_OVERLAP", error.code)
        assertTrue(server.sentTo("GET", "/api/v1/plans").isEmpty())
    }
}
