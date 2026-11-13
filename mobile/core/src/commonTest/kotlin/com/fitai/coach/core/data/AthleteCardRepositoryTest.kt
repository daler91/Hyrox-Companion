package com.fitai.coach.core.data

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** The athlete card as the plan generator reads it: retired facts are left out. */
class AthleteCardRepositoryTest {
    private val server = FakeServer()
    private val card = AthleteCardRepository(server.api)

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

    private fun fact(id: String, text: String, active: Boolean) =
        """{"id":"$id","userId":"u1","fact":"$text","dedupeKey":"$id","category":"constraint","source":"athlete",""" +
            """"active":$active,"reviewOn":"2027-02-01","createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
}
