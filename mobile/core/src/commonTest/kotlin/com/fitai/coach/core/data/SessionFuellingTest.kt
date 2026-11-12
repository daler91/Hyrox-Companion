package com.fitai.coach.core.data

import com.fitai.coach.core.api.generated.GetNutritionPlannedSessionEstimateByPlanDayIdResponse
import com.fitai.coach.core.nutrition.MealFuelOverride
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionFuellingTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val nutrition = NutritionRepository(server.api, CacheStore(db) { 0L })
    private val fuelling = nutrition.fuelling

    @AfterTest
    fun closeDatabase() = db.close()

    @Test
    fun aWorkoutsFuellingIsKeptAndGoesWhenEveryDayIsRefreshed() = runTest {
        server.on("GET", "/api/v1/nutrition/session-fuelling/w1", 200, SESSION)
        fuelling.refreshAroundWorkout("w1")

        val kept = fuelling.aroundWorkout("w1").first()!!
        assertEquals(25.0, kept.gap.postProteinG)
        assertEquals(false, kept.usedStartTime)
        assertNull(fuelling.aroundWorkout("w2").first())

        // A change every day reads (here a meal's target) drops it with the days.
        server.on("POST", "/api/v1/nutrition/meal-targets", 201)
        server.on("GET", "/api/v1/nutrition/summary", 200, EMPTY_DAY)
        nutrition.targets.setMealTarget(Meal.Lunch, MealFuelOverride(proteinG = 40.0), "2026-11-09")

        assertNull(fuelling.aroundWorkout("w1").first())
    }

    @Test
    fun theTimelinesDaysAreAskedForAsOneRangeAndKept() = runTest {
        server.on("GET", "/api/v1/nutrition/summary-range", 200, RANGE)
        fuelling.refreshDays("2026-11-02", "2026-11-29")

        val query = server.sentTo("GET", "/api/v1/nutrition/summary-range").single().query
        assertTrue("from=2026-11-02" in query && "to=2026-11-29" in query, query)
        val day = fuelling.days.first()!!.days.single()
        assertEquals(1840.0, day.totals.calories)
        assertEquals(2400.0, day.effectiveTarget?.calories)
        assertTrue(day.hasPostWorkoutFuel)
    }

    @Test
    fun aPlannedSessionsEstimateIsAskedForByItsDay() = runTest {
        server.on(
            "GET",
            "/api/v1/nutrition/planned-session-estimate/d1",
            200,
            """{"planDayId":"d1","durationMin":60,"rpe":8,"rationale":"Six 800s.","source":"structure","refined":true}""",
        )

        val estimate = fuelling.plannedEstimate("d1")

        assertEquals(60.0, estimate.durationMin)
        assertEquals(8.0, estimate.rpe)
        assertEquals(GetNutritionPlannedSessionEstimateByPlanDayIdResponse.Source.Structure, estimate.source)
    }

    private companion object {
        const val EMPTY_DAY = """{"logDate":"2026-11-09","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"meals":{"breakfast":[],"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

        const val SESSION = """{"workoutId":"w1","date":"2026-11-08","usedStartTime":false,"pre":[],"post":[],""" +
            """"preTotals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"postTotals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"target":{"preCarbG":30,"postCarbG":60,"postProteinG":25,"reasonCodes":[],"explanation":"Guidance only."},""" +
            """"gap":{"preCarbG":30,"postCarbG":60,"postProteinG":25}}"""

        const val RANGE = """{"from":"2026-11-02","to":"2026-11-29","days":[{"date":"2026-11-12",""" +
            """"totals":{"calories":1840,"protein":120,"carb":200,"fat":60,"fiber":20},""" +
            """"effectiveTarget":{"calories":2400,"proteinG":150,"carbDeltaG":0,"baseLoadDeltaG":0,"recoveryDeltaG":0,""" +
            """"preloadDeltaG":0,"proteinDeltaG":0,"utss":0,"scaled":false,"reasonCodes":[],"explanation":""},""" +
            """"hasPostWorkoutFuel":true}]}"""
    }
}
