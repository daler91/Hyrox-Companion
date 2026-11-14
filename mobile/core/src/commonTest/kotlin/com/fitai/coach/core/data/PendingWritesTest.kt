package com.fitai.coach.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

private fun planned(dayId: String) =
    """{"id":"plan-$dayId","date":"2026-11-10","type":"planned","status":"planned","focus":"Run","mainWorkout":"5 km",""" +
        """"planDayId":"$dayId"}"""

private fun logged(workoutId: String) =
    """{"id":"log-$workoutId","date":"2026-11-10","type":"logged","status":"completed","focus":"Lift","mainWorkout":"",""" +
        """"workoutLogId":"$workoutId"}"""

/** Which plan days and workouts still have changes to send: the timeline's "Pending sync". */
class PendingWritesTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { newIdempotencyKey() })
    private val timeline = TimelineRepository(db, server.api, sync, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    private suspend fun seed() {
        server.on("GET", "/api/v1/timeline", 200, "[${planned("d1")},${planned("d2")},${logged("w1")}]")
        timeline.refresh()
    }

    private suspend fun entry(id: String) = timeline.entries.first().single { it.id == id }

    @Test
    fun queuedWritesNameThePlanDayOrWorkoutTheyChange() = runTest {
        seed()

        // A log that completes d1 names it in its body; the others in their paths.
        timeline.markDone(entry("plan-d1"))
        timeline.skip(entry("plan-d2"), reason = null)
        timeline.move(entry("log-w1"), newDate = "2026-11-12", today = "2026-11-10")

        assertEquals(setOf("d1", "d2", "w1"), sync.pendingIds.first())
    }

    @Test
    fun aWriteTheServerTookIsNoLongerPending() = runTest {
        seed()
        server.on("PATCH", "/api/v1/plans/days/d2/status", 200, "{}")
        timeline.skip(entry("plan-d2"), reason = null)

        sync.sync()

        assertEquals(emptySet(), sync.pendingIds.first())
    }
}
