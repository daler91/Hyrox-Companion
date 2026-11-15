package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.GetNutritionBlockResponse
import com.fitai.coach.core.api.generated.GetNutritionBlockResponse.PointsItem
import com.fitai.coach.ui.format.formatNumber
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FuellingModelTest {
    private fun day(calories: Double, carb: Double, target: Double?, rpe: Double?, compliance: Double? = null) =
        PointsItem(
            date = "2026-11-01",
            calories = calories,
            protein = 0.0,
            carb = carb,
            fat = 0.0,
            fiber = 0.0,
            utss = 50.0,
            carbTargetG = target,
            avgRpe = rpe,
            compliancePct = compliance,
        )

    @Test
    fun theCardReadsTheServersComparison() {
        val correlation = ApiJson.decodeFromString(
            GetNutritionBlockResponse.Correlation.serializer(),
            """{"status":"ok","rpe":{"hitDays":3,"missDays":3,"hitAvg":6.5,"missAvg":8,"delta":-1.5},"compliance":null,""" +
                """"eligibleDays":6,"carbHitPct":90,"reasonCodes":["insufficient_compliance_days"],"explanation":"How it works."}""",
        )
        val result = FuellingCorrelation.of(correlation)
        assertTrue(result.ok)
        assertEquals(FuellingCorrelation(MetricComparison(3, 3, 6.5, 8.0, -1.5), null, 6, 90, "How it works."), result)

        val notYet = FuellingCorrelation.of(
            correlation.copy(status = GetNutritionBlockResponse.Correlation.Status.InsufficientData, rpe = null),
        )
        assertFalse(notYet.ok)
        assertNull(notYet.rpe)
    }

    @Test
    fun theDifferencesReadAsTheWebsDo() {
        assertEquals("1.5 lower (felt easier)", rpeDeltaText(MetricComparison(3, 3, 6.5, 8.0, -1.5)))
        assertEquals("0.4 higher (felt harder)", rpeDeltaText(MetricComparison(3, 3, 7.4, 7.0, 0.4)))
        assertEquals("no clear difference", rpeDeltaText(MetricComparison(3, 3, 7.1, 7.0, 0.1)))
        assertEquals("10 pts better", complianceDeltaText(MetricComparison(3, 3, 95.0, 85.0, 10.0)))
        assertEquals("4 pts worse", complianceDeltaText(MetricComparison(3, 3, 81.0, 85.0, -4.0)))
        assertEquals("about the same", complianceDeltaText(MetricComparison(3, 3, 86.0, 85.0, 1.0)))
        assertEquals(
            "6.5 on carb-hit days (3) vs 8 missed (3) — 1.5 lower (felt easier)",
            comparisonLine(MetricComparison(3, 3, 6.5, 8.0, -1.5), ::formatNumber, "1.5 lower (felt easier)"),
        )
    }

    @Test
    fun theTabShowsOnceAnyDayHasFood() {
        assertTrue(hasIntake(listOf(day(0.0, 0.0, null, null), day(1800.0, 200.0, null, null))))
        assertFalse(hasIntake(listOf(day(0.0, 0.0, 300.0, 7.0))))
    }
}
