package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.readTestResource
import com.fitai.coach.core.nutrition.MealFuelOverride
import com.fitai.coach.core.nutrition.PeriodizationChoice
import com.fitai.coach.core.nutrition.nextPeriodizationSettings
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TargetSettingsTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val nutrition = NutritionRepository(server.api, CacheStore(db) { 0L })
    private val targets = nutrition.targets

    @AfterTest
    fun closeDatabase() = db.close()

    private fun summary(calories: Int) =
        """{"logDate":"2026-11-08","totals":{"calories":$calories,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"meals":{"breakfast":[],"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

    private fun sent(method: String, path: String): JsonObject =
        ApiJson.parseToJsonElement(server.sentTo(method, path).single().body!!).jsonObject

    private fun JsonObject.number(key: String): Double = getValue(key).jsonPrimitive.content.toDouble()

    @Test
    fun aSaveSendsTheGoalsAndTheirPeriodisationAndRefreshesTheDays() = runTest {
        server.on(
            "GET",
            "/api/v1/nutrition/targets",
            200,
            """{"current":{"id":"t1","userId":"u1","calories":2400,"carbG":300,"periodizationEnabled":true,"referenceUtss":42.5,""" +
                """"carbGramsPerUtss":3.6,"recoveryEnabled":false,"phaseAware":false,"effectiveFrom":"2026-10-01"},"history":[]}""",
        )
        server.on("POST", "/api/v1/nutrition/targets", 201)
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(0))
        nutrition.refreshDay("2026-11-07")

        val current = targets.current()!!
        val periodization = nextPeriodizationSettings(
            current.storedPeriodization(),
            PeriodizationChoice(carbG = 150.0, periodize = true, recoveryEnabled = true, phaseAware = true),
            recentAvgDailyUtss = 30.0,
        )
        targets.save(MacroTargets(calories = 2200.0, proteinG = null, carbG = 150.0, fatG = 70.0), periodization, "2026-11-08")

        val body = sent("POST", "/api/v1/nutrition/targets")
        assertEquals(2200.0, body.number("calories"))
        assertEquals(JsonNull, body["proteinG"])
        // The calibrated reference is kept and the slope re-based onto half the carbs.
        assertEquals(42.5, body.number("referenceUtss"))
        assertEquals(1.8, body.number("carbGramsPerUtss"))
        assertEquals("true", body.getValue("recoveryEnabled").jsonPrimitive.content)
        assertEquals(1.0, body.number("preloadDaysAhead"))
        assertNull(body["id"])
        assertNull(body["effectiveFrom"])
        // A target changes every day's summary: other days are dropped, this one fetched.
        assertNull(nutrition.day("2026-11-07").first())
        assertEquals(0.0, nutrition.day("2026-11-08").first()!!.totals.calories)
    }

    @Test
    fun turningPeriodisationOffClearsItsColumns() = runTest {
        server.on("POST", "/api/v1/nutrition/targets", 201)
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(0))

        val off =
            nextPeriodizationSettings(null, PeriodizationChoice(300.0, periodize = false, recoveryEnabled = true, phaseAware = true), null)
        targets.save(MacroTargets(2600.0, 150.0, 300.0, 80.0), off, "2026-11-08")

        val body = sent("POST", "/api/v1/nutrition/targets")
        assertEquals("false", body.getValue("periodizationEnabled").jsonPrimitive.content)
        assertEquals(JsonNull, body["referenceUtss"])
        assertEquals(JsonNull, body["maxCarbDeltaG"])
        assertEquals("false", body.getValue("phaseAware").jsonPrimitive.content)
    }

    @Test
    fun aMealIsPinnedAndReset() = runTest {
        server.on("POST", "/api/v1/nutrition/meal-targets", 201)
        server.on("DELETE", "/api/v1/nutrition/meal-targets/snack_pm", 200, """{"success":true}""")
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(0))

        targets.setMealTarget(Meal.SnackPm, MealFuelOverride(proteinG = 40.0), "2026-11-08")
        targets.clearMealTarget(Meal.SnackPm, "2026-11-08")

        val body = sent("POST", "/api/v1/nutrition/meal-targets")
        assertEquals("snack_pm", body.getValue("mealType").jsonPrimitive.content)
        assertEquals(40.0, body.number("proteinG"))
        // An unpinned field is sent as null: it follows the split.
        assertEquals(JsonNull, body["calories"])
        assertEquals(1, server.sentTo("DELETE", "/api/v1/nutrition/meal-targets/snack_pm").size)
        assertEquals(2, server.sentTo("GET", "/api/v1/nutrition/summary").size)
    }

    @Test
    fun theTypicalLoadIsTheChronicAverage() = runTest {
        val sample = ApiJson.parseToJsonElement(readTestResource("api-samples/GetTrainingOverview.json")!!).jsonObject
        server.on("GET", "/api/v1/training-overview", 200, sample.getValue("response").jsonObject.getValue("min").toString())

        assertEquals(1.5, targets.typicalDailyLoad())
    }
}
