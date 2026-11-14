package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.GetMafTestsResponse
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

private const val MAF = "/api/v1/workouts/w1/maf-test"

private fun test(workoutId: String, avgHr: Int? = null) =
    """{"id":"t-$workoutId","userId":"u1","protocolType":"maf_test","version":1,""" +
        """"conditions":{"source":"workout_tag","workoutLogId":"$workoutId"},""" +
        """"metrics":{"avgHeartRate":${avgHr ?: "null"},"mafCeilingUsed":140}}"""

private fun score(workoutId: String, pct: Int) =
    """{"id":"a-$workoutId","userId":"u1","workoutLogId":"$workoutId","compliancePct":$pct,"version":1}"""

private fun tagged(workoutId: String, avgHr: Int?, pct: Int?) =
    """{"testResult":${test(workoutId, avgHr)},"analysis":${pct?.let { score(workoutId, it) } ?: "null"}}"""

/** The MAF tests kept on the device: fetched, and following each tag, correction and removal the server answers. */
class MafTestRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val cache = CacheStore(db) { 0L }
    private val mafTests = MafTestRepository(server.api, cache)

    @AfterTest
    fun closeDatabase() = db.close()

    private suspend fun kept() = mafTests.tests.first()

    private suspend fun keep(json: String) =
        cache.put("analytics:maf-tests", GetMafTestsResponse.serializer(), ApiJson.decodeFromString(json))

    @Test
    fun theListIsKeptOnTheDevice() = runTest {
        server.on("GET", "/api/v1/maf-tests", 200, """{"tests":[],"analysis":[],"workoutDates":{"w1":"2026-11-02"}}""")

        mafTests.refresh()

        assertEquals(mapOf("w1" to "2026-11-02"), kept()?.workoutDates)
    }

    @Test
    fun taggingSendsEveryMetricWithBlanksAsNullAndPutsTheTestFirst() = runTest {
        keep("""{"tests":[${test("w0", 140)}],"analysis":[${score("w0", 90)}],"workoutDates":{"w0":"2026-11-01"}}""")
        server.on("POST", MAF, 200, tagged("w1", avgHr = 138, pct = 96))

        mafTests.tag("w1", MafMetrics(avgHeartRate = 138, durationSeconds = 1710))

        assertEquals(
            """{"metrics":{"avgHeartRate":138,"maxHeartRate":null,"durationSeconds":1710,"distanceMeters":null}}""",
            server.sentTo("POST", MAF).single().body,
        )
        assertEquals(listOf("w1", "w0"), kept()?.tests?.map { it.conditions?.workoutLogId })
        assertEquals(listOf(96L, 90L), kept()?.analysis?.map { it.compliancePct })
        assertEquals(mapOf("w0" to "2026-11-01"), kept()?.workoutDates)
    }

    @Test
    fun aCorrectionKeepsItsPlaceAndDropsAScoreItNoLongerHas() = runTest {
        keep(
            """{"tests":[${test("w2", 141)},${test("w1", 138)},${test("w0", 140)}],""" +
                """"analysis":[${score("w1", 96)},${score("w0", 90)}],"workoutDates":{}}""",
        )
        server.on("PATCH", MAF, 200, tagged("w1", avgHr = null, pct = null))

        mafTests.update("w1", MafMetrics(maxHeartRate = 151, distanceMeters = 5000.0))

        assertEquals(
            """{"metrics":{"avgHeartRate":null,"maxHeartRate":151,"durationSeconds":null,"distanceMeters":5000.0}}""",
            server.sentTo("PATCH", MAF).single().body,
        )
        assertEquals(listOf("w2", "w1", "w0"), kept()?.tests?.map { it.conditions?.workoutLogId })
        assertEquals(null, kept()?.tests?.get(1)?.metrics?.avgHeartRate)
        assertEquals(listOf<String?>("w0"), kept()?.analysis?.map { it.workoutLogId })
    }

    @Test
    fun removingTakesTheRunAndItsScoreOutOfTheList() = runTest {
        keep("""{"tests":[${test("w1", 138)},${test("w0", 140)}],"analysis":[${score("w1", 96)}],"workoutDates":{}}""")
        server.on("DELETE", MAF, 200, """{"success":true}""")

        mafTests.untag("w1")

        assertEquals(listOf<String?>("w0"), kept()?.tests?.map { it.conditions?.workoutLogId })
        assertEquals(emptyList(), kept()?.analysis)
    }
}
