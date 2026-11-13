package com.fitai.coach.core.data

import com.fitai.coach.core.api.generated.PatchAthleteFactsByIdRequest
import com.fitai.coach.core.api.generated.PostAthleteFactsRequest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The athlete card: the plan generator reads what is in force, Settings keeps the whole card. */
class AthleteCardRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val card = AthleteCardRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    @Test
    fun onlyFactsStillInForceAreRead() = runTest {
        server.on(
            "GET",
            "/api/v1/athlete-facts",
            200,
            "[${fact("f1", "No box jumps", active = true)},${fact("f2", "Old ankle sprain", active = false)}]",
        )

        assertEquals(listOf("No box jumps"), card.activeFacts().map { it.fact })
    }

    @Test
    fun eachChangeTheServerAcceptsIsKeptInTheCachedCard() = runTest {
        assertNull(card.facts.first())
        server.on("GET", "/api/v1/athlete-facts", 200, "[${fact("f1", "No box jumps", active = true)}]")
        card.refresh()

        server.on("POST", "/api/v1/athlete-facts", 200, fact("f2", "No sled at my gym", active = true))
        card.add("No sled at my gym", PostAthleteFactsRequest.Category.Equipment)
        server.on("PATCH", "/api/v1/athlete-facts/f1", 200, fact("f1", "No box jumps", active = false))
        card.update("f1", PatchAthleteFactsByIdRequest(active = false))
        assertEquals(listOf("f1" to false, "f2" to true), card.facts.first().orEmpty().map { it.id to it.active })
        assertEquals("""{"active":false}""", server.sentTo("PATCH", "/api/v1/athlete-facts/f1").single().body)

        server.on("DELETE", "/api/v1/athlete-facts/f1", 200, """{"success":true}""")
        card.delete("f1")
        assertEquals(listOf("f2"), card.facts.first().orEmpty().map { it.id })
    }

    private fun fact(id: String, text: String, active: Boolean) =
        """{"id":"$id","userId":"u1","fact":"$text","dedupeKey":"$id","category":"constraint","source":"athlete",""" +
            """"active":$active,"reviewOn":"2027-02-01","createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
}
