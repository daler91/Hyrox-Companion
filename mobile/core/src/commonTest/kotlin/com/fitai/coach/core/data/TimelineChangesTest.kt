package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.TimelineEntry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val TIMELINE = "/api/v1/timeline"

/** Older pages, moving a session, and deleting or restoring a day. */
class TimelineChangesTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { newIdempotencyKey() })
    private val timeline = TimelineRepository(db, server.api, sync, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    private fun page(vararg entries: String, next: String? = null) =
        Reply.Respond(200, "[" + entries.joinToString(",") + "]", next?.let { mapOf("X-Next-Cursor" to it) }.orEmpty())

    private suspend fun ids() = timeline.entries.first().map { it.id }

    private suspend fun entry(id: String): TimelineEntry = timeline.entries.first().single { it.id == id }

    private fun logged(id: String, date: String) =
        """{"id":"$id","date":"$date","type":"logged","status":"completed","focus":"Run","mainWorkout":"5 km","workoutLogId":"w-$id"}"""

    private fun planned(id: String, date: String, status: String = "planned", dayName: String? = null) =
        """{"id":"$id","date":"$date","type":"planned","status":"$status","focus":"Tempo","mainWorkout":"6 x 800 m",""" +
            """"planDayId":"d-$id"""" + (dayName?.let { ""","dayName":"$it"""" } ?: "") + "}"

    @Test
    fun olderPagesLoadOnDemandAndARefreshKeepsThem() = runTest {
        server.on("GET", TIMELINE) { sent ->
            when {
                "before=2026-11-01" in sent.query -> page(logged("old-2", "2026-10-20"), logged("old-1", "2026-10-15"), next = "2026-10-15")
                "before=2026-10-15" in sent.query -> page(logged("oldest", "2026-09-01"))
                else -> page(planned("p1", "2026-11-10"), logged("recent", "2026-11-01"), next = "2026-11-01")
            }
        }
        timeline.refresh()
        assertEquals("2026-11-01", timeline.olderCursor.value)

        assertEquals(2, timeline.loadOlder().size)
        assertEquals("2026-10-15", timeline.olderCursor.value)

        // A refresh replaces only the first page's dates.
        timeline.refresh()
        assertEquals(listOf("p1", "recent", "old-2", "old-1"), ids())
        assertEquals("2026-10-15", timeline.olderCursor.value, "the next page to load is still the one after the oldest here")

        timeline.loadOlder()
        assertNull(timeline.olderCursor.value)
        assertEquals("oldest", ids().last())
        assertTrue(timeline.loadOlder().isEmpty())
    }

    @Test
    fun aFirstPageWithTheWholeHistoryReplacesEverything() = runTest {
        server.on("GET", TIMELINE) { page(logged("a", "2026-11-01"), logged("b", "2026-10-01"), next = "2026-11-01") }
        timeline.refresh()
        server.on("GET", TIMELINE) { sent ->
            if ("before" in
                sent.query
            ) {
                page(logged("b", "2026-10-01"))
            } else {
                page(logged("a", "2026-11-01"), next = "2026-11-01")
            }
        }
        timeline.loadOlder()

        server.on("GET", TIMELINE) { page(logged("a", "2026-11-01")) }
        timeline.refresh()

        assertEquals(listOf("a"), ids())
        assertNull(timeline.olderCursor.value)
    }

    @Test
    fun movingAPlanDayShowsAtOnceWithItsWeekdayAndSendsTheScheduledDate() = runTest {
        server.on("GET", TIMELINE) { page(planned("p1", "2026-11-10", dayName = "Tuesday")) }
        timeline.refresh()
        server.on("PATCH", "/api/v1/plans/days/d-p1", 200, "{}")

        timeline.move(entry("p1"), "2026-11-12", today = "2026-11-09")

        assertEquals("2026-11-12", entry("p1").date)
        assertEquals("Thursday", entry("p1").dayName)
        sync.sync()
        val body = ApiJson.parseToJsonElement(server.sentTo("PATCH", "/api/v1/plans/days/d-p1").single().body!!).jsonObject
        assertEquals("2026-11-12", body["scheduledDate"]!!.jsonPrimitive.content)
    }

    @Test
    fun aMissedDayMovedForwardIsPlannedAgainAndRemembersWhenItWasMissed() = runTest {
        server.on("GET", TIMELINE) { page(planned("p1", "2026-11-05", status = "missed")) }
        timeline.refresh()

        timeline.move(entry("p1"), "2026-11-11", today = "2026-11-09")

        val moved = entry("p1")
        assertEquals(TimelineEntry.Status.Planned, moved.status)
        assertEquals(TimelineEntry.Recovery.Folded, moved.recovery)
        assertEquals("2026-11-05", moved.missedOn)
    }

    @Test
    fun movingALoggedWorkoutChangesItsDateAndItsDetail() = runTest {
        server.on("GET", TIMELINE) { page(logged("l1", "2026-11-05")) }
        timeline.refresh()
        server.on("GET", "/api/v1/workouts/w-l1", 200, Samples.workout("w-l1"))
        WorkoutRepository(db, server.api, sync) { "k" }.refresh("w-l1")
        server.on("PATCH", "/api/v1/workouts/w-l1", 200, Samples.workout("w-l1"))

        timeline.move(entry("l1"), "2026-11-06", today = "2026-11-09")

        assertEquals("2026-11-06", entry("l1").date)
        assertEquals("2026-11-06", WorkoutRepository(db, server.api, sync) { "k" }.workout("w-l1").first()?.date)
        sync.sync()
        assertEquals(1, server.sentTo("PATCH", "/api/v1/workouts/w-l1").size)
    }

    @Test
    fun aMoveTheServerRefusesForGoodShowsTheServersDayAgain() = runTest {
        server.on("GET", TIMELINE) { page(planned("p1", "2026-11-10")) }
        timeline.refresh()
        server.on("PATCH", "/api/v1/plans/days/d-p1", 400, """{"error":"Bad","code":"VALIDATION_ERROR"}""")

        timeline.move(entry("p1"), "2026-11-12", today = "2026-11-09")
        repeat(SyncEngine.MAX_ATTEMPTS + 1) { sync.sync() }

        assertEquals("2026-11-10", entry("p1").date)
    }

    @Test
    fun aDeletedPlanDayLeavesAtOnceAndRestoringBringsItBack() = runTest {
        server.on("GET", TIMELINE) { page(planned("p1", "2026-11-10", status = "skipped"), logged("l1", "2026-11-05")) }
        timeline.refresh()
        server.on("DELETE", "/api/v1/plans/days/d-p1", 200, """{"success":true,"recycleBinItemId":"rb9"}""")

        assertEquals("rb9", timeline.deletePlanDay("d-p1"))
        assertEquals(listOf("l1"), ids())

        server.on("POST", "/api/v1/recycle-bin/rb9/restore", 200, """{"ok":true,"entityType":"plan_day","entityId":"d-p1","warnings":[]}""")
        timeline.restore("rb9")
        assertEquals(listOf("p1", "l1"), ids())
    }

    @Test
    fun aDeletedWorkoutIsForgottenEvenOnAnOlderPage() = runTest {
        server.on("GET", TIMELINE) { page(logged("l1", "2026-11-05"), planned("p1", "2026-11-04", status = "completed")) }
        timeline.refresh()

        timeline.forgetWorkout("w-l1")

        assertEquals(listOf("p1"), ids())
    }
}
