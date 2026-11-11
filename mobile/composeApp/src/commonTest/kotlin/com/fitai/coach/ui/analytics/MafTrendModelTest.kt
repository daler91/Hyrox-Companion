package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.GetMafTestsResponse
import com.fitai.coach.core.api.generated.MafTestResult
import com.fitai.coach.core.api.generated.MafWorkoutAnalysis
import com.fitai.coach.ui.components.BadgeTone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MafTrendModelTest {
    private fun test(
        id: String,
        workout: String?,
        createdAt: String,
        metres: Double? = 8000.0,
        seconds: Double? = 2880.0,
        hr: Double? = 141.0,
    ) =
        MafTestResult(
            id = id,
            userId = "u1",
            protocolType = "distance",
            version = 1,
            conditions = workout?.let { MafTestResult.Conditions("workout_tag", it) },
            metrics = MafTestResult.Metrics(seconds, metres, hr, mafCeilingUsed = 145.0),
            createdAt = createdAt,
        )

    private fun scored(workout: String, pct: Long, classification: String, createdAt: String = "2026-11-10T08:00:00Z") =
        MafWorkoutAnalysis(
            id = "a-$workout",
            userId = "u1",
            workoutLogId = workout,
            compliancePct = pct,
            classification = classification,
            version = 1,
            createdAt = createdAt,
        )

    private val response = GetMafTestsResponse(
        tests = listOf(
            // Tagged today, but the run was last week: it sorts by the run.
            test("t1", "w1", "2026-11-10T08:00:00Z"),
            test("t2", "w2", "2026-11-09T08:00:00Z", metres = null),
            // Its workout was deleted: dated by the local tag day (Auckland is a day ahead).
            test("t3", null, "2026-10-20T20:00:00Z", hr = null),
        ),
        analysis = listOf(scored("w1", 92, "compliant"), scored("w2", 70, "over_ceiling")),
        workoutDates = mapOf("w1" to "2026-11-02", "w2" to "2026-11-08"),
    )

    @Test
    fun testsSortByTheirWorkoutsDayAndCarryTheirCompliance() {
        val rows = mafRows(response, "Pacific/Auckland")
        assertEquals(listOf("t2", "t1", "t3"), rows.map { it.id })
        assertEquals(listOf("2026-11-08", "2026-11-02", "2026-10-21"), rows.map { it.date })
        assertEquals(70L, rows[0].compliancePct)
        assertNull(rows[2].compliancePct)
    }

    @Test
    fun theTrendsRunOldestFirstAndPaceNeedsADistance() {
        assertEquals(listOf(Point("2026-11-02", 92.0), Point("2026-11-08", 70.0)), mafComplianceTrend(response, "UTC"))
        val rows = mafRows(response, "UTC")
        // 8 km in 48 minutes is 6:00/km; t2 has no distance to make a pace from.
        assertEquals(listOf("2026-10-20" to 360.0, "2026-11-02" to 360.0), mafPaceTrend(rows, "km").map { it.date to it.value })
        assertEquals(579, mafPaceTrend(rows, "miles").first().value.toInt())
    }

    @Test
    fun aRowReadsPaceTimeAndHeartRate() {
        val rows = mafRows(response, "UTC")
        assertEquals("6:00/km · 48:00 · 141 bpm", mafRowDetail(rows.first { it.id == "t1" }, "km"))
        assertEquals("48:00 · 141 bpm", mafRowDetail(rows.first { it.id == "t2" }, "km"))
        assertEquals("Nov 2, 2026", mafTestDate("2026-11-02"))
        assertEquals("—", mafTestDate(null))
    }

    @Test
    fun classificationsAndBadgesReadAsTheWebsDo() {
        assertEquals("Compliant" to BadgeTone.Success, mafClassification("compliant"))
        assertEquals("Mostly compliant" to BadgeTone.Warning, mafClassification("mostly_compliant"))
        assertEquals("Over ceiling" to BadgeTone.Danger, mafClassification("over_ceiling"))
        assertEquals("Unscored" to BadgeTone.Warning, mafClassification(null))
        assertEquals("1 MAF test", mafCountLabel(1))
        assertEquals("3 MAF tests", mafCountLabel(3))
        assertEquals("Latest: 70% · Over ceiling", mafLatestLabel(mafRows(response, "UTC").first()))
    }

    @Test
    fun speedNeedsAPositiveDistanceAndTime() {
        assertEquals(2.5, metersPerSecond(1000.0, 400.0))
        assertNull(metersPerSecond(0.0, 400.0))
        assertNull(metersPerSecond(1000.0, null))
        assertNull(paceSecondsPerUnit(0.0, "km"))
    }

    @Test
    fun theMafTabIsOnlyForMafStyleAthletes() {
        assertEquals(true, AnalyticsTab.Maf in analyticsTabs(MAF_TRAINING_STYLE))
        assertEquals(false, AnalyticsTab.Maf in analyticsTabs("hyrox"))
        assertEquals(true, AnalyticsTab.Fuelling in analyticsTabs(null))
    }
}
