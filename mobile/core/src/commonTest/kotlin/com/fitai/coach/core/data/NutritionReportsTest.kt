package com.fitai.coach.core.data

import com.fitai.coach.core.nutrition.MealFuelOverride
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NutritionReportsTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val nutrition = NutritionRepository(server.api, CacheStore(db) { 0L })
    private val reports = nutrition.reports

    @AfterTest
    fun closeDatabase() = db.close()

    private fun micros(date: String, ironMg: Int) =
        """{"date":"$date","micros":[{"key":"iron","label":"Iron","unit":"mg","amount":$ironMg,"rdi":18,"pctRdi":${ironMg * 100 / 18}}]}"""

    private val emptyDay =
        """{"logDate":"2026-11-08","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"meals":{"breakfast":[],"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

    @Test
    fun aDaysMicrosAreKeptAndGoWhenEveryDayIsRefreshed() = runTest {
        server.on("GET", "/api/v1/nutrition/micros", 200, micros("2026-11-08", 9))
        reports.refreshMicros("2026-11-08")

        assertEquals(9.0, reports.micros("2026-11-08").first()!!.micros.single().amount)
        assertTrue("date=2026-11-08" in server.sentTo("GET", "/api/v1/nutrition/micros").single().query)
        assertNull(reports.micros("2026-11-07").first())

        // A change every day reads (here a meal's target) drops the days, and their micros with them.
        server.on("POST", "/api/v1/nutrition/meal-targets", 201)
        server.on("GET", "/api/v1/nutrition/summary", 200, emptyDay)
        nutrition.targets.setMealTarget(Meal.Lunch, MealFuelOverride(proteinG = 40.0), "2026-11-09")

        assertNull(reports.micros("2026-11-08").first())
    }

    @Test
    fun insightsAreReadWithoutAiAndKeptWhenGenerated() = runTest {
        server.on("GET", "/api/v1/nutrition/insights", 200, """{"insights":null}""")
        reports.refreshInsights()
        assertNull(reports.insights.first()!!.insights)

        server.on(
            "POST",
            "/api/v1/nutrition/insights",
            200,
            """{"insights":"Fuel your long runs.","generatedAt":"2026-11-10T09:30:00.000Z","stale":false}""",
        )
        reports.regenerateInsights()

        val kept = reports.insights.first()!!
        assertEquals("Fuel your long runs.", kept.insights)
        assertEquals("2026-11-10T09:30:00.000Z", kept.generatedAt)
        assertEquals(false, kept.stale)
    }
}
