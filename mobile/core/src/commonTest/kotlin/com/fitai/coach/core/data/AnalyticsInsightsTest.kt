package com.fitai.coach.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val PREDICTION = "/api/v1/race-prediction"
private const val INSIGHTS = "/api/v1/coach-insights"
private const val CHART_ANALYSIS = "/api/v1/overview-analysis"

internal fun racePredictionJson(totalSeconds: Int = 5025, aiUsed: Boolean = false) =
    """{"totalFinishSeconds":$totalSeconds,"segments":[{"index":0,"kind":"run","exerciseName":"running","label":"Run 1",""" +
        """"estimatedSeconds":290,"basis":"logged","confidence":"medium","sampleSize":6}],"transitionSeconds":300,""" +
        """"aiUsed":$aiUsed,"aiUnavailableReason":${if (aiUsed) "null" else "\"ai_consent_off\""},"overallConfidence":"medium",""" +
        """"division":"open","gender":"male","genderAssumed":false,"ageGroup":"30-34","ageGroupAssumed":false,""" +
        """"percentile":null,"raceReadiness":null,"dataCompleteness":{"stationsWithData":6,"totalStations":8,"hasRunData":true},""" +
        """"generatedAt":"2026-11-10T09:30:00.000Z","stale":false}"""

/** The race prediction and Coach Insights kept on the device; session grades fetched fresh. */
class AnalyticsInsightsTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val analytics = AnalyticsRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    @Test
    fun theStoredPredictionIsFetchedWithoutSpendingAiAndKept() = runTest {
        server.on("GET", PREDICTION, 200, racePredictionJson())

        analytics.refreshRacePrediction()

        assertEquals("", server.sentTo("GET", PREDICTION).single().query)
        assertEquals(5025.0, analytics.racePrediction.first()?.totalFinishSeconds)
    }

    @Test
    fun regeneratingAsksForAFreshPrediction() = runTest {
        server.on("GET", PREDICTION, 200, racePredictionJson(totalSeconds = 4900, aiUsed = true))

        analytics.refreshRacePrediction(regenerate = true)

        assertEquals("refresh=1", server.sentTo("GET", PREDICTION).single().query)
        assertEquals(true, analytics.racePrediction.first()?.aiUsed)
    }

    @Test
    fun sessionGradesAreForTheActivePlanUnlessOneIsPicked() = runTest {
        server.on("GET", "/api/v1/session-grades", 200, """{"plan":null,"sessions":[],"weeks":[],"blocks":[],"totals":null}""")

        assertNull(analytics.sessionGrades().plan)
        analytics.sessionGrades("p2")

        assertEquals(listOf("", "planId=p2"), server.sentTo("GET", "/api/v1/session-grades").map { it.query })
    }

    @Test
    fun regeneratedInsightsReplaceTheStoredOnes() = runTest {
        server.on("GET", INSIGHTS, 200, """{"insights":null,"ragInfo":null,"generatedAt":null,"stale":null}""")
        analytics.refreshCoachInsights()
        assertNull(analytics.coachInsights.first()?.insights)

        server.on(
            "POST",
            INSIGHTS,
            200,
            """{"insights":"## On track","ragInfo":{"source":"none","chunkCount":0},""" +
                """"generatedAt":"2026-11-10T09:30:00.000Z","stale":false}""",
        )
        analytics.regenerateCoachInsights()

        assertEquals("## On track", analytics.coachInsights.first()?.insights)
    }

    @Test
    fun theChartReadingIsKeptPerRangeAndNamesTheRangeAsTheWebDoes() = runTest {
        server.on("GET", CHART_ANALYSIS, 200, """{"sections":null,"ragInfo":null,"generatedAt":null}""")
        analytics.refreshOverviewAnalysis(AnalyticsRange.Quarter)
        assertNull(analytics.overviewAnalysis(AnalyticsRange.Quarter).first()?.sections)

        server.on(
            "POST",
            CHART_ANALYSIS,
            200,
            """{"sections":{"trainingLoad":"Load is steady.","bodySystems":null,"formMonotony":null,"objectiveLoad":null,""" +
                """"weeklyWorkouts":null,"rpeDuration":null,"consistency":null},"ragInfo":null,""" +
                """"generatedAt":"2026-11-10T09:30:00.000Z","rangeDays":null,"stale":false}""",
        )
        analytics.regenerateOverviewAnalysis(AnalyticsRange.All)

        assertEquals("range=90", server.sentTo("GET", CHART_ANALYSIS).single().query)
        assertEquals("range=all", server.sentTo("POST", CHART_ANALYSIS).single().query)
        assertEquals("Load is steady.", analytics.overviewAnalysis(AnalyticsRange.All).first()?.sections?.trainingLoad)
        assertNull(analytics.overviewAnalysis(AnalyticsRange.Quarter).first()?.sections)
    }

    @Test
    fun theFuellingBlockCoversTheRangeAndAllTimeIsHeldToAYear() = runTest {
        server.on("GET", "/api/v1/nutrition/block", 200, """{"from":"2026-08-13","to":"2026-11-10","points":[]}""")

        analytics.refreshNutritionBlock(AnalyticsRange.Quarter, "2026-11-10")
        analytics.refreshNutritionBlock(AnalyticsRange.All, "2026-11-10")

        assertEquals(
            listOf("from=2026-08-13&to=2026-11-10", "from=2025-11-10&to=2026-11-10"),
            server.sentTo("GET", "/api/v1/nutrition/block").map { it.query },
        )
        assertEquals("2026-08-13", analytics.nutritionBlock(AnalyticsRange.Quarter).first()?.from)
    }
}
