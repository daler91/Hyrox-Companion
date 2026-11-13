package com.fitai.coach.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The recycle bin: each change the server accepts is applied to the cached bin, counts included. */
class RecycleBinRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val bin = RecycleBinRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    @Test
    fun aRestoredOrPurgedItemLeavesTheCachedBin() = runTest {
        assertNull(bin.bin.first())
        server.on(
            "GET",
            "/api/v1/recycle-bin",
            200,
            """{"items":[${item("r1", "workout_log")},${item("r2", "training_plan")},${item("r3", "plan_day")}],""" +
                """"counts":{"total":3,"workout_log":1,"plan_day":1,"training_plan":1}}""",
        )
        val items = bin.refresh().items

        server.on(
            "POST",
            "/api/v1/recycle-bin/r1/restore",
            200,
            """{"ok":true,"entityType":"workout_log","entityId":"w1","warnings":["Its plan day is gone."]}""",
        )
        assertEquals(listOf("Its plan day is gone."), bin.restore(items[0]).warnings)
        server.on("DELETE", "/api/v1/recycle-bin/r2", 200, """{"success":true}""")
        bin.purge(items[1])

        val cached = bin.bin.first()!!
        assertEquals(listOf("r3"), cached.items.map { it.id })
        assertEquals(listOf(1L, 0L, 1L, 0L), with(cached.counts) { listOf(total, workoutLog, planDay, trainingPlan) })

        server.on("DELETE", "/api/v1/recycle-bin", 200, """{"success":true,"purgedCount":1}""")
        assertEquals(1, bin.empty())
        assertEquals(0, bin.bin.first()!!.counts.total)
    }

    private fun item(id: String, type: String) =
        """{"id":"$id","entityType":"$type","entityId":"e-$id","label":"Item $id","childCount":0,""" +
            """"deletedAt":"2026-11-10T09:00:00Z","expiresAt":"2027-02-08T09:00:00Z"}"""
}
