package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val REVIEW = "/api/v1/weekly-review"

internal fun weeklyReviewJson(weekStart: String = "2026-11-02", intent: String? = null) =
    """{"weekStart":"$weekStart","weekEnd":"2026-11-08","timezone":"UTC","isCurrentWeek":false,"weeklyGoal":4,"hasPlan":true,""" +
        """"current":{"sessionsLogged":3,"sessionsPlanned":4,"plannedCompleted":3,"missed":1,"skipped":0,"outstanding":0,""" +
        """"excused":0,"letGo":0,"totalDurationMin":150,"avgRpe":7},""" +
        """"previous":{"sessionsLogged":2,"sessionsPlanned":4,"plannedCompleted":2,"missed":2,"skipped":0,"outstanding":0,""" +
        """"excused":0,"letGo":0,"totalDurationMin":100,"avgRpe":null},""" +
        """"deltas":{"sessionsLogged":1,"totalDurationMin":50},"sessions":[],"plannedDays":[],"personalRecords":[],"annotations":[],""" +
        """"intent":${intent?.let { "\"$it\"" } ?: "null"}}"""

class ReviewRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val reviews = ReviewRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    @Test
    fun aWeekIsAskedForByAnyDateInIt() = runTest {
        server.on("GET", REVIEW, 200, weeklyReviewJson())

        assertEquals("2026-11-02", reviews.review("2026-11-05").weekStart)
        assertEquals("week=2026-11-05", server.sentTo("GET", REVIEW).single().query)
    }

    @Test
    fun withNoWeekTheServerPicksTheLastCompletedOne() = runTest {
        server.on("GET", REVIEW, 200, weeklyReviewJson())

        reviews.review(null)

        assertEquals("", server.sentTo("GET", REVIEW).single().query)
    }

    @Test
    fun anIntentIsSavedAndAnEmptyOneClearsIt() = runTest {
        server.on("POST", "$REVIEW/intent", 200, """{"weekStart":"2026-11-02","intent":"Three runs"}""")
        assertEquals("Three runs", reviews.setIntent("2026-11-02", "Three runs"))

        server.on("POST", "$REVIEW/intent", 200, """{"weekStart":"2026-11-02","intent":null}""")
        assertNull(reviews.setIntent("2026-11-02", null))

        val sent = server.sentTo("POST", "$REVIEW/intent").map { ApiJson.parseToJsonElement(it.body!!).jsonObject }
        assertEquals("2026-11-02", sent[0]["week"]!!.jsonPrimitive.content)
        assertEquals("Three runs", sent[0]["intent"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, sent[1]["intent"])
    }

    @Test
    fun aDismissedPromptIsRememberedForItsWeek() = runTest {
        assertNull(reviews.dismissedPrompt.first())

        reviews.dismissPrompt("2026-11-02")

        assertEquals("2026-11-02", reviews.dismissedPrompt.first())
    }
}
