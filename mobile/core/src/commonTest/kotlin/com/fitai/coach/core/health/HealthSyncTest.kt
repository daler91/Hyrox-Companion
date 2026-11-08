package com.fitai.coach.core.health

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.data.FakeServer
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class HealthSyncTest {
    private val server = FakeServer()

    private class FakeSource(var granted: Boolean = true) : HealthDataSource {
        val tokensAsked = mutableListOf<String?>()
        var changes = HealthChanges(emptyList(), emptyList(), "t1")

        override suspend fun availability() = HealthAvailability.Available

        override suspend fun hasPermissions() = granted

        override suspend fun changesSince(token: String?): HealthChanges {
            tokensAsked += token
            return changes
        }
    }

    private class MemoryStore : HealthSyncStore {
        override var enabledFor: String? = null
        val tokens = mutableMapOf<String, String?>()

        override fun token(userId: String) = tokens[userId]

        override fun saveToken(userId: String, token: String?) {
            tokens[userId] = token
        }
    }

    private val source = FakeSource()
    private val store = MemoryStore()
    private val sync = HealthSync(server.api, source, store)

    private fun session(i: Int) = HealthSession("s$i", "2026-11-08T07:00:00Z", "2026-11-08T07:45:00Z", 60, "Run", distanceMeters = 8000.0)

    private fun accepting() = server.on("POST", "/api/v1/health-connect/sync") { sent ->
        val count = ApiJson.parseToJsonElement(sent.body!!).jsonObject["sessions"]!!.jsonArray.size
        com.fitai.coach.core.data.Reply.Respond(200, """{"imported":$count,"skipped":0,"deleted":0}""")
    }

    @Test
    fun turningItOnRunsAFirstSyncFromNoTokenAndKeepsTheNext() = runTest {
        accepting()
        source.changes = HealthChanges(listOf(session(1)), emptyList(), "t1")
        assertEquals(HealthSyncResult(1, 0, 0), sync.enable("u1"))
        assertEquals(listOf<String?>(null), source.tokensAsked)
        assertEquals("t1", store.tokens["u1"])
        assertEquals("u1", store.enabledFor)

        source.changes = HealthChanges(emptyList(), listOf("s0"), "t2")
        sync.sync("u1")
        assertEquals(listOf(null, "t1"), source.tokensAsked)
        assertEquals("t2", store.tokens["u1"])
    }

    @Test
    fun aLargeBacklogGoesInChunksTheServerAccepts() = runTest {
        accepting()
        source.changes = HealthChanges((1..230).map(::session), emptyList(), "t1")
        assertEquals(230, sync.enable("u1").imported)
        assertEquals(
            listOf(100, 100, 30),
            server.sentTo("POST", "/api/v1/health-connect/sync").map {
                ApiJson.parseToJsonElement(it.body!!).jsonObject["sessions"]!!.jsonArray.size
            },
        )
    }

    @Test
    fun aRefusedChunkKeepsTheOldReadPosition() = runTest {
        accepting()
        sync.enable("u1")
        server.on("POST", "/api/v1/health-connect/sync", 500, """{"error":"boom"}""")
        source.changes = HealthChanges(listOf(session(1)), emptyList(), "t2")
        assertFailsWith<ApiException> { sync.sync("u1") }
        assertEquals("t1", store.tokens["u1"])
    }

    @Test
    fun itSyncsOnlyForTheUserWhoTurnedItOnWhilePermissionsHold() = runTest {
        accepting()
        sync.enable("u1")
        assertNull(sync.sync("u2"))
        source.granted = false
        assertNull(sync.sync("u1"))
        assertFailsWith<IllegalStateException> { sync.enable("u1") }

        sync.disable()
        assertNull(store.enabledFor)
        assertNull(store.tokens["u1"])
    }
}
