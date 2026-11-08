package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStatusRequest
import com.fitai.coach.core.api.generated.TimelineEntry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TimelineRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { "key" })
    private val timeline = TimelineRepository(db, server.api, sync, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    private val planDay = """{"id":"plan-d1","date":"2026-11-08","type":"planned","status":"planned","focus":"Run",""" +
        """"mainWorkout":"5 km easy","notes":"keep it chatty","planDayId":"d1"}"""

    private suspend fun seed(vararg entries: String) {
        server.on("GET", "/api/v1/timeline", 200, "[" + entries.joinToString(",") + "]")
        timeline.refresh()
    }

    private suspend fun entry(id: String): TimelineEntry = timeline.entries.first().single { it.id == id }

    private fun body(sent: Sent) = ApiJson.parseToJsonElement(sent.body!!).jsonObject

    @Test
    fun aRefreshStoresTheEntriesInTheServersOrder() = runTest {
        seed(Samples.timelineEntry("plan-2", "2026-11-04"), Samples.timelineEntry("log-1", "2026-11-02", "completed"))

        assertEquals(listOf("plan-2", "log-1"), timeline.entries.first().map { it.id })
    }

    @Test
    fun aRefreshDropsEntriesTheServerNoLongerHas() = runTest {
        seed(Samples.timelineEntry("plan-2", "2026-11-04"), Samples.timelineEntry("plan-1", "2026-11-03"))

        seed(Samples.timelineEntry("plan-1", "2026-11-03"))

        assertEquals(listOf("plan-1"), timeline.entries.first().map { it.id })
    }

    @Test
    fun markingADayDoneShowsAtOnceAndLogsItThroughTheOutbox() = runTest {
        seed(planDay)
        server.on("POST", "/api/v1/workouts", 201)

        timeline.markDone(entry("plan-d1"), rpe = 6, notes = null)

        assertEquals(TimelineEntry.Status.Completed, entry("plan-d1").status)
        sync.sync()
        val sent = body(server.sentTo("POST", "/api/v1/workouts").single())
        assertEquals("d1", sent["planDayId"]!!.jsonPrimitive.content)
        assertEquals("2026-11-08", sent["date"]!!.jsonPrimitive.content)
        assertEquals("6", sent["rpe"]!!.jsonPrimitive.content)
        assertEquals("keep it chatty", sent["notes"]!!.jsonPrimitive.content)
        assertNull(sent["accessory"])
    }

    @Test
    fun skippingSendsTheReasonAndReopeningPutsTheDayBack() = runTest {
        seed(planDay)
        server.on("PATCH", "/api/v1/plans/days/d1/status", 200)

        timeline.skip(entry("plan-d1"), PatchPlansDaysByDayIdStatusRequest.SkipReason.LowEnergy)
        assertEquals(TimelineEntry.Status.Skipped, entry("plan-d1").status)
        assertEquals(TimelineEntry.SkipReason.LowEnergy, entry("plan-d1").skipReason)

        timeline.reopen(entry("plan-d1"))
        assertEquals(TimelineEntry.Status.Planned, entry("plan-d1").status)

        sync.sync()
        val sent = server.sentTo("PATCH", "/api/v1/plans/days/d1/status").map { body(it) }
        assertEquals(listOf("skipped", "planned"), sent.map { it["status"]!!.jsonPrimitive.content })
        assertEquals("low_energy", sent[0]["skipReason"]!!.jsonPrimitive.content)
        assertNull(sent[1]["skipReason"])
    }

    @Test
    fun recoverySendsTheChosenActionThenRefreshes() = runTest {
        seed(planDay)
        server.on("POST", "/api/v1/plans/days/d1/recovery", 200)

        timeline.recover("d1", RecoveryAction.Fold("2026-11-10"))
        timeline.recover("d1", RecoveryAction.LetGo)

        val sent = server.sentTo("POST", "/api/v1/plans/days/d1/recovery").map { body(it) }
        assertEquals("fold", sent[0]["action"]!!.jsonPrimitive.content)
        assertEquals("2026-11-10", sent[0]["targetDate"]!!.jsonPrimitive.content)
        assertEquals("let_go", sent[1]["action"]!!.jsonPrimitive.content)
        assertNull(sent[1]["targetDate"])
        assertEquals(3, server.sentTo("GET", "/api/v1/timeline").size)
    }
}
