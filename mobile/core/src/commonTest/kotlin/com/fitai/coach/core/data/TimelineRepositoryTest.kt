package com.fitai.coach.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class TimelineRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val timeline = TimelineRepository(db, server.api)

    @AfterTest
    fun closeDatabase() = db.close()

    @Test
    fun aRefreshStoresTheEntriesInTheServersOrder() = runTest {
        server.on(
            "GET",
            "/api/v1/timeline",
            200,
            "[" + Samples.timelineEntry("plan-2", "2026-11-04") + "," + Samples.timelineEntry("log-1", "2026-11-02", "completed") + "]",
        )

        timeline.refresh()

        assertEquals(listOf("plan-2", "log-1"), timeline.entries.first().map { it.id })
    }

    @Test
    fun aRefreshDropsEntriesTheServerNoLongerHas() = runTest {
        val both = "[" + Samples.timelineEntry("plan-2", "2026-11-04") + "," + Samples.timelineEntry("plan-1", "2026-11-03") + "]"
        server.on("GET", "/api/v1/timeline", 200, both)
        timeline.refresh()
        server.on("GET", "/api/v1/timeline", 200, "[" + Samples.timelineEntry("plan-1", "2026-11-03") + "]")

        timeline.refresh()

        assertEquals(listOf("plan-1"), timeline.entries.first().map { it.id })
    }
}
